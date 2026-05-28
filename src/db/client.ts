import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import * as schema from "#/db/schema";
import path from "node:path";
import { existsSync, mkdirSync, readdirSync } from "node:fs";

const MIGRATION_RETRY_ATTEMPTS = 5;
const MIGRATION_RETRY_DELAY_MS = 100;
const RETRYABLE_MIGRATION_ERROR =
  /SQLITE_BUSY|database is locked|table .* already exists|index .* already exists|duplicate column name/i;

type MigrationRunner = (db: Database, config: { migrationsFolder: string }) => unknown;
type DatabaseLike = {
  exec: (sql: string) => unknown;
  close: () => void;
};

export type Database = ReturnType<typeof createDb>;

// ── Database factory ──────────────────────────────────────────────────────────

function createDb(client: DatabaseSync) {
  return drizzle({ client, relations: schema.relations, casing: "snake_case" });
}

function isDrizzleMigrationsFolder(candidate: string): boolean {
  if (!existsSync(candidate)) {
    return false;
  }

  try {
    return readdirSync(candidate, { withFileTypes: true }).some(
      (entry) =>
        entry.isDirectory() && existsSync(path.join(candidate, entry.name, "migration.sql")),
    );
  } catch {
    return false;
  }
}

function isRetryableMigrationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return RETRYABLE_MIGRATION_ERROR.test(message);
}

function sleepSync(ms: number): void {
  if (ms <= 0) {
    return;
  }

  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function retrySqliteBusy<T>(
  operation: () => T,
  options: {
    maxAttempts?: number;
    retryDelayMs?: number;
  } = {},
): T {
  const maxAttempts = options.maxAttempts ?? MIGRATION_RETRY_ATTEMPTS;
  const retryDelayMs = options.retryDelayMs ?? MIGRATION_RETRY_DELAY_MS;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return operation();
    } catch (error) {
      if (!isRetryableMigrationError(error) || attempt === maxAttempts) {
        throw error;
      }

      sleepSync(retryDelayMs);
    }
  }

  throw new Error("Unreachable retry state");
}

export function resolveMigrationsFolder(baseDir = import.meta.dirname): string {
  const candidates = [path.resolve(baseDir, "migrations")];

  const found = candidates.find(isDrizzleMigrationsFolder);
  if (!found) {
    throw new Error(`Could not find Drizzle migrations folder from '${baseDir}'`);
  }

  return found;
}

/**
 * Row shape returned by the cross-entity corruption diagnostic.
 */
type CrossEntityCorruptRow = {
  id: string;
  title: string;
  project_id: string;
  workspace_id: string;
  workspace_project_id: string;
};

/**
 * Pre-migration fail-loud guard for the `cross_entity_triggers` migration.
 *
 * That migration installs SQLite triggers that enforce, from then on, the
 * invariant `prd_revisions.workspace_id` belongs to the same project as
 * `prd_revisions.project_id`. The triggers only fire on future writes — they
 * cannot retroactively reject rows that are already corrupt, and a migration
 * that silently leaves corrupt rows behind hides a real data bug.
 *
 * So before that migration runs we execute its diagnostic SELECT and, if any
 * inconsistent PRD revisions exist, abort the whole migration batch with a
 * clear message pointing at `depot project diagnose`. The check is skipped
 * once the triggers already exist (migration already applied) and is a no-op
 * on a database whose schema predates the `prd_revisions` table.
 */
function assertCrossEntityConsistency(db: Database): void {
  const client = (db as unknown as { $client?: { prepare?: DatabaseSync["prepare"] } }).$client;
  // No usable SQLite handle (e.g. a stubbed `migrateFn` in tests) — nothing to
  // check; the migrator itself will surface any real schema problem.
  if (!client || typeof client.prepare !== "function") {
    return;
  }

  const triggerExists = client
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = 'prd_revisions_workspace_consistency_insert'",
    )
    .get();
  if (triggerExists) {
    return;
  }

  const tableExists = client
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'prd_revisions'")
    .get();
  if (!tableExists) {
    return;
  }

  const corrupt = client
    .prepare(
      `SELECT p.id AS id, p.title AS title, p.project_id AS project_id,
              p.workspace_id AS workspace_id, w.project_id AS workspace_project_id
       FROM prd_revisions p
       JOIN workspaces w ON w.id = p.workspace_id
       WHERE p.workspace_id IS NOT NULL
         AND p.project_id != w.project_id`,
    )
    .all() as CrossEntityCorruptRow[];

  if (corrupt.length === 0) {
    return;
  }

  const details = corrupt
    .map(
      (row) =>
        `  - PRD ${row.id} ('${row.title}') project=${row.project_id} but workspace ${row.workspace_id} is in project=${row.workspace_project_id}`,
    )
    .join("\n");
  throw new Error(
    `Migration aborted: ${corrupt.length} PRD revision(s) violate the project/workspace ` +
      `consistency invariant enforced by the 'cross_entity_triggers' migration.\n${details}\n` +
      `Run \`depot project diagnose\` to inspect these rows, fix them, then re-run the migration.`,
  );
}

export function applyMigrations(
  db: Database,
  options: {
    baseDir?: string;
    migrateFn?: MigrationRunner;
    maxAttempts?: number;
    retryDelayMs?: number;
  } = {},
): void {
  const migrationsFolder = resolveMigrationsFolder(options.baseDir);
  const migrateFn = options.migrateFn ?? migrate;
  retrySqliteBusy(() => {
    assertCrossEntityConsistency(db);
    migrateFn(db, { migrationsFolder });
  }, options);
}

/**
 * Open (or create) the depot database at the given path.
 * Automatically creates the parent directory if it does not exist.
 * Runs pending migrations automatically.
 * Use `":memory:"` for tests.
 */
export function openDatabase(dbPath: string): { db: Database; client: DatabaseSync } {
  if (dbPath === ":memory:") {
    return openDatabaseWith(dbPath, {
      databaseFactory: (p) => new DatabaseSync(p),
      createDbFn: (client) => createDb(client),
    });
  }

  const dir = path.dirname(dbPath);
  try {
    mkdirSync(dir, { recursive: true });
  } catch (error) {
    throw new Error(
      `Failed to create depot directory '${dir}'. Check permissions.\n${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return openDatabaseWith(dbPath, {
    databaseFactory: (p) => new DatabaseSync(p),
    createDbFn: (client) => createDb(client),
  });
}

export function openDatabaseWith<TClient extends DatabaseLike = DatabaseSync>(
  path: string,
  options: {
    databaseFactory: (path: string) => TClient;
    createDbFn?: (client: TClient) => Database;
    migrateFn?: MigrationRunner;
    baseDir?: string;
    maxAttempts?: number;
    retryDelayMs?: number;
  },
): { db: Database; client: TClient } {
  const { databaseFactory } = options;
  const createDbFn =
    options.createDbFn ?? ((client: TClient) => createDb(client as unknown as DatabaseSync));

  return retrySqliteBusy(() => {
    const client = databaseFactory(path);

    try {
      client.exec("PRAGMA journal_mode = WAL;");
      client.exec("PRAGMA busy_timeout = 5000;");
      client.exec("PRAGMA foreign_keys = ON;");
      const db = createDbFn(client);
      // Apply unapplied SQL migrations generated by drizzle-kit.
      applyMigrations(db, options);
      return { db, client };
    } catch (error) {
      client.close();
      throw error;
    }
  });
}

/**
 * Resolve the default depot directory: `~/.depot`.
 * Normalises backslashes so the path is forward-slash everywhere.
 */
export function defaultDepotDir(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  return `${home.replace(/\\/g, "/")}/.depot`;
}

/**
 * Describes which database the CLI is about to operate on.
 *
 * - `prod`   : the user's real `~/.depot/depot.db` (no env override).
 * - `dev`    : an explicit override whose path contains `.depot-dev`
 *              (the convention used by this repo's local dev workflow).
 * - `custom` : any other explicit override (CI, throwaway tests, etc.).
 */
export type DbMode = { kind: "prod" | "dev" | "custom"; path: string };

const DEV_PATH_SEGMENT = ".depot-dev";

function classifyOverride(rawPath: string): DbMode {
  const kind = rawPath.includes(DEV_PATH_SEGMENT) ? "dev" : "custom";
  return { kind, path: rawPath };
}

/**
 * Resolve which database the CLI is going to open, without opening it.
 *
 * Precedence:
 * 1. `DEPOT_DB_PATH` (current, preferred env var).
 * 2. `DB_PATH`       (legacy env var, still honoured for one release).
 * 3. `~/.depot/depot.db` (production default).
 */
export function currentDbMode(): DbMode {
  const explicit = process.env["DEPOT_DB_PATH"];
  if (explicit) {
    return classifyOverride(explicit);
  }
  const legacy = process.env["DB_PATH"];
  if (legacy) {
    return classifyOverride(legacy);
  }
  return { kind: "prod", path: `${defaultDepotDir()}/depot.db` };
}

/**
 * Resolve the default database path. Delegates to `currentDbMode()` so that
 * env var precedence and the dev/custom/prod classification live in one place.
 */
export function defaultDbPath(): string {
  return currentDbMode().path;
}
