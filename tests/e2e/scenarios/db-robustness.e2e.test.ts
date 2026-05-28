import { chmod, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "vite-plus/test";
import { e2eScenario, getRepoRoot } from "../runtime";

/**
 * PRD 0016 / T4 — Migrations + DB robustness.
 *
 * Three independent scenarios that exercise depot's behaviour against a
 * SQLite database that is not the freshly-migrated happy-path one:
 *
 *  1. **Upward migration** — seed a tmp DB with only the *oldest* drizzle
 *     migration SQL (and the matching `__drizzle_migrations` bookkeeping
 *     row), drop a row into a table that existed at that point, then let
 *     depot open the DB. depot must apply every later migration on the
 *     fly and the seeded row must survive intact. Tables introduced by
 *     subsequent migrations (`adrs`, `project_repo`, `prd_repo`, …) must
 *     be present afterwards.
 *
 *  2. **Corrupted DB** — drop non-SQLite bytes at `<scenarioRoot>/depot.db`.
 *     `depot --version` must not touch the DB (exit 0), but a command that
 *     does need it (`depot project list`) must fail with a non-zero exit
 *     and an error message that mentions the underlying SQLite condition.
 *
 *  3. **Read-only DB** — initialise a real DB, `chmod 444` it, then verify
 *     reads still work and writes fail cleanly with a message containing
 *     `readonly`.
 *
 * NOTE on the corrupted / read-only sub-cases: depot currently surfaces
 * SQLite / drizzle failures as `(FiberFailure)` blobs that include a
 * full JS stack trace. The PRD flags this style as "stack trace
 * cryptique" and asks the author to either fix it in `src/` or document
 * the behaviour with a `// FIXME` and assert what depot does today. We
 * picked the second option: the test asserts the human-readable substrings
 * we *do* care about (`file is not a database`, `readonly`) and tolerates
 * the trace prefix until a follow-up wraps `openDatabase` and the effect
 * runtime's unhandled failures in a friendlier formatter.
 */

const SEED_PROJECT_ID = "proj-seed-mig-asc";
const SEED_PROJECT_NAME = "Seeded Project (migration ascendante)";

type ProjectListPayload = {
  items: ReadonlyArray<{ id: string; name: string; status: string }>;
};

describe("e2e DB robustness — migrations + corrupted + read-only (PRD 0016 / T4)", () => {
  it("1. upward migration: seed N-1, depot auto-migrates, seeded row survives", async () => {
    await e2eScenario(async (ctx) => {
      const dbPath = path.join(ctx.root, "depot.db");
      const oldest = await findOldestMigration();
      await seedWithOldestMigration(dbPath, oldest);

      const payload = await ctx.agent.runJson<ProjectListPayload>("depot --json project list");

      const seeded = payload.items.find((p) => p.id === SEED_PROJECT_ID);
      if (!seeded) {
        throw new Error(
          `expected seeded project '${SEED_PROJECT_ID}' to survive auto-migration, ` +
            `got items=${JSON.stringify(payload.items)}`,
        );
      }
      if (seeded.name !== SEED_PROJECT_NAME) {
        throw new Error(
          `expected seeded project name '${SEED_PROJECT_NAME}', got '${seeded.name}'`,
        );
      }

      ctx.expect.dbHas("projects", { id: SEED_PROJECT_ID });

      const tables = readTableNames(dbPath);
      const requiredLaterTables = ["adrs", "project_repo", "prd_repo"] as const;
      for (const table of requiredLaterTables) {
        if (!tables.has(table)) {
          throw new Error(
            `expected migrations to create table '${table}', present tables: ${[...tables].sort().join(", ")}`,
          );
        }
      }

      const drizzleRows = readDrizzleMigrations(dbPath);
      if (drizzleRows < 2) {
        throw new Error(
          `expected __drizzle_migrations to have grown past the seeded baseline (>= 2 rows), got ${drizzleRows}`,
        );
      }
    }, "upward migration from oldest schema");
  });

  it("2. corrupted DB: --version still works, project list fails cleanly", async () => {
    await e2eScenario(async (ctx) => {
      const dbPath = path.join(ctx.root, "depot.db");
      await writeFile(dbPath, "this is definitely not a sqlite database\n", "utf-8");

      const version = await ctx.agent.run("depot --version", { expectExit: "any" });
      ctx.expect.exitCode(version, 0);
      ctx.expect.contains(version.stdout, ".");

      const listing = await ctx.agent.run("depot project list", { expectExit: "any" });
      if (listing.exitCode === 0) {
        throw new Error(
          `expected non-zero exit for project list against a corrupted DB, got 0\n` +
            `stdout: ${listing.stdout}\nstderr: ${listing.stderr}`,
        );
      }
      const combined = `${listing.stdout}\n${listing.stderr}`;
      ctx.expect.contains(combined, "file is not a database");

      // FIXME(PRD 0016 / T4): depot surfaces SQLite open failures as an effect
      //   `(FiberFailure)` blob with a full JS stack trace instead of a
      //   one-line, path-prefixed error message. The PRD calls this out
      //   ("pas de stack trace cryptique"). We assert today's behaviour
      //   verbatim so a future fix that rewraps the error must consciously
      //   delete this expectation. The visible-to-the-user error string
      //   (`file is not a database`) is checked above, which is what
      //   matters for the "graceful failure" acceptance criterion.
      ctx.expect.contains(listing.stderr, "FiberFailure");
    }, "corrupted DB file");
  });

  it("3. read-only DB: reads succeed, writes fail with a readable message", async () => {
    await e2eScenario(async (ctx) => {
      const dbPath = path.join(ctx.root, "depot.db");
      const seedRepo = await ctx.git.initRepo("ro-seed");
      await ctx.agent.run("depot init ro-seed", { cwd: seedRepo });

      const initialList = await ctx.agent.run("depot --json project list");
      ctx.expect.exitCode(initialList, 0);
      ctx.expect.contains(initialList.stdout, "ro-seed");

      await chmod(dbPath, 0o444);

      const readAttempt = await ctx.agent.run("depot --json project list");
      ctx.expect.exitCode(readAttempt, 0);
      ctx.expect.contains(readAttempt.stdout, "ro-seed");

      const newRepo = await ctx.git.initRepo("project-x");
      const writeAttempt = await ctx.agent.run("depot init project-x", {
        cwd: newRepo,
        expectExit: "any",
      });
      if (writeAttempt.exitCode === 0) {
        throw new Error(
          `expected non-zero exit when writing to a chmod 444 DB, got 0\n` +
            `stdout: ${writeAttempt.stdout}\nstderr: ${writeAttempt.stderr}`,
        );
      }
      const combined = `${writeAttempt.stdout}\n${writeAttempt.stderr}`.toLowerCase();
      if (!combined.includes("readonly") && !combined.includes("read-only")) {
        throw new Error(
          `expected write-to-read-only error to mention 'readonly'/'read-only', got: ${combined}`,
        );
      }

      // FIXME(PRD 0016 / T4): same caveat as case 2 — depot relays the
      //   drizzle `DatabaseError` through the effect runtime, which prints
      //   `(FiberFailure)` plus the underlying JS stack. The error message
      //   ("attempt to write a readonly database") is correct and contains
      //   the keyword the user needs, but the surrounding noise is what
      //   the PRD wants killed. Asserting it here so the FIXME is hard to
      //   miss when someone wraps the failure prettily.
      ctx.expect.contains(writeAttempt.stderr, "FiberFailure");

      await chmod(dbPath, 0o644);
    }, "read-only DB");
  });
});

// ── Helpers (scoped to this scenario file) ────────────────────────────────────

type OldestMigration = {
  readonly name: string;
  readonly sql: string;
  readonly hash: string;
  readonly folderMillis: number;
};

async function findOldestMigration(): Promise<OldestMigration> {
  const migrationsDir = path.join(getRepoRoot(), "src", "db", "migrations");
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  const candidates = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  if (candidates.length === 0) {
    throw new Error(`no migrations found under ${migrationsDir}`);
  }
  const oldestName = candidates[0]!;
  const sqlPath = path.join(migrationsDir, oldestName, "migration.sql");
  const sql = await readFile(sqlPath, "utf-8");
  const hash = crypto.createHash("sha256").update(sql).digest("hex");
  const folderMillis = parseFolderMillis(oldestName);
  return { name: oldestName, sql, hash, folderMillis };
}

function parseFolderMillis(folderName: string): number {
  const stamp = folderName.slice(0, 14);
  const year = Number.parseInt(stamp.slice(0, 4), 10);
  const month = Number.parseInt(stamp.slice(4, 6), 10) - 1;
  const day = Number.parseInt(stamp.slice(6, 8), 10);
  const hour = Number.parseInt(stamp.slice(8, 10), 10);
  const minute = Number.parseInt(stamp.slice(10, 12), 10);
  const second = Number.parseInt(stamp.slice(12, 14), 10);
  return Date.UTC(year, month, day, hour, minute, second);
}

async function seedWithOldestMigration(dbPath: string, mig: OldestMigration): Promise<void> {
  const db = new DatabaseSync(dbPath);
  try {
    for (const raw of mig.sql.split("--> statement-breakpoint")) {
      const stmt = raw.trim();
      if (stmt.length > 0) {
        db.exec(stmt);
      }
    }

    db.exec(
      "CREATE TABLE __drizzle_migrations (" +
        "id INTEGER PRIMARY KEY, " +
        "hash text NOT NULL, " +
        "created_at numeric, " +
        "name text, " +
        "applied_at TEXT)",
    );
    db.prepare(
      "INSERT INTO __drizzle_migrations (hash, created_at, name, applied_at) " +
        "VALUES (?, ?, ?, ?)",
    ).run(mig.hash, mig.folderMillis, mig.name, new Date().toISOString());

    const now = Date.now();
    db.prepare(
      "INSERT INTO projects (id, name, status, created_at, updated_at) " +
        "VALUES (?, ?, 'active', ?, ?)",
    ).run(SEED_PROJECT_ID, SEED_PROJECT_NAME, now, now);
  } finally {
    db.close();
  }
}

function readTableNames(dbPath: string): Set<string> {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as unknown as ReadonlyArray<{ name: string }>;
    return new Set(rows.map((r) => r.name));
  } finally {
    db.close();
  }
}

function readDrizzleMigrations(dbPath: string): number {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db.prepare("SELECT COUNT(*) AS n FROM __drizzle_migrations").get() as {
      n: number | bigint;
    };
    return Number(row.n);
  } finally {
    db.close();
  }
}
