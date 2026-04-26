/**
 * Seed script for local UI development.
 * Clears the default depot database and inserts a representative dataset
 * that exercises every project/PRD/task/review status combination,
 * including activity_log entries with terminal output and file changes.
 *
 * Usage: bun run seed
 */

import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "#/db/schema";
import { generateId } from "#/shared/utils";
import path from "node:path";
import { existsSync, unlinkSync, mkdirSync } from "node:fs";

const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
const dbPath = process.env["DB_PATH"] ?? `${home.replace(/\\/g, "/")}/.depot/depot.db`;
const migrationsFolder = path.resolve(import.meta.dirname, "../src/db/migrations");

if (existsSync(dbPath)) {
  try {
    unlinkSync(dbPath);
    console.log(`Dropped old database at: ${dbPath}`);
  } catch (err: unknown) {
    const isLocked =
      err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "EBUSY";
    if (!isLocked) throw err;

    console.log("Database is locked; dropping all tables in-place...");
    const tmp = new Database(dbPath);
    tmp.exec("PRAGMA foreign_keys = OFF;");
    const tables = tmp
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';",
      )
      .all();
    for (const { name } of tables) {
      tmp.exec(`DROP TABLE IF EXISTS "${name}";`);
    }
    tmp.exec("PRAGMA foreign_keys = ON;");
    tmp.close();
    console.log("All tables dropped.");
  }
}

const dbDir = path.dirname(dbPath);
mkdirSync(dbDir, { recursive: true });

console.log(`Creating fresh database at: ${dbPath}`);

const client = new Database(dbPath);
client.exec("PRAGMA journal_mode = WAL;");
client.exec("PRAGMA foreign_keys = ON;");
const db = drizzle({ client, relations: schema.relations, casing: "snake_case" });

migrate(db, { migrationsFolder });
console.log("Migrations applied.");

// ── Helpers ───────────────────────────────────────────────────────────────────

function id() {
  return generateId();
}

function ago(days: number, hours = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(d.getHours() - hours);
  return d;
}

type TerminalLine = { text: string; type: "command" | "output" };
type FileChange = { path: string; added: number; removed: number };

function terminalPayload(lines: TerminalLine[]): string {
  return JSON.stringify({ kind: "terminal", lines });
}

function donePayload(files: FileChange[]): string {
  return JSON.stringify({ files });
}

// ── Projects ─────────────────────────────────────────────────────────────────

const proj1 = id();
const proj2 = id();
const proj3 = id();

await db.insert(schema.projects).values([
  {
    id: proj1,
    name: "Depot CLI",
    description: "Local-first AI agent task and PRD management tool built on Bun + SQLite.",
    status: "active",
    createdAt: ago(60),
    updatedAt: ago(1),
  },
  {
    id: proj2,
    name: "Web Dashboard",
    description: "Read-only web UI for browsing depot state, served by `depot serve`.",
    status: "paused",
    createdAt: ago(45),
    updatedAt: ago(10),
  },
  {
    id: proj3,
    name: "Legacy Migration",
    description: "One-off migration of the v1 flat-file tasks into depot SQLite.",
    status: "done",
    createdAt: ago(90),
    updatedAt: ago(20),
  },
]);

// ── Workspaces ────────────────────────────────────────────────────────────────

const ws1 = id();
const ws2 = id();
const ws3 = id();

await db.insert(schema.workspaces).values([
  {
    id: ws1,
    projectId: proj1,
    path: "/home/user/projects/depot",
    label: "main",
    createdAt: ago(60),
    updatedAt: ago(1),
  },
  {
    id: ws2,
    projectId: proj2,
    path: "/home/user/projects/depot-web",
    label: "web",
    createdAt: ago(45),
    updatedAt: ago(10),
  },
  {
    id: ws3,
    projectId: proj3,
    path: "/home/user/projects/legacy-migration",
    label: null,
    createdAt: ago(90),
    updatedAt: ago(20),
  },
]);

// ── PRDs ─────────────────────────────────────────────────────────────────────

const prdDraft = id();
const prdReady = id();
const prdInProgress = id();
const prdInProgressV2 = id();
const prdDone = id();
const prdCanceled = id();
const prdDoneV1 = id();
const prdDoneV2 = id();
const prdDoneV3 = id();
const prdDraftNoTasks = id();

await db.insert(schema.prds).values([
  {
    id: prdDraft,
    projectId: proj1,
    workspaceId: null,
    rootId: prdDraft,
    parentId: null,
    revision: 1,
    title: "Plugin system for depot commands",
    context: "Users need a way to extend depot with custom commands without forking the repo.",
    scope: "Includes: command registration API, plugin discovery. Excludes: marketplace, auth.",
    status: "draft",
    createdAt: ago(5),
    updatedAt: ago(1),
    readyAt: null,
    activatedAt: null,
  },
  {
    id: prdReady,
    projectId: proj1,
    workspaceId: null,
    rootId: prdReady,
    parentId: null,
    revision: 1,
    title: "Structured task description format v2",
    context:
      "The current structured_v1 format lacks support for acceptance criteria sub-items and code snippets.",
    scope: "Includes: new schema, migration path, CLI rendering. Excludes: web renderer changes.",
    status: "ready",
    createdAt: ago(12),
    updatedAt: ago(3),
    readyAt: ago(3),
    activatedAt: null,
  },
  {
    id: prdInProgress,
    projectId: proj1,
    workspaceId: ws1,
    rootId: prdInProgress,
    parentId: null,
    revision: 1,
    title: "Activity log viewer command",
    context: "Agents and humans need a quick way to replay what happened in a session.",
    scope: "Includes: `depot log` command, filters by project/prd/task. Excludes: export.",
    status: "done",
    createdAt: ago(20),
    updatedAt: ago(8),
    readyAt: ago(18),
    activatedAt: ago(15),
  },
  {
    id: prdInProgressV2,
    projectId: proj1,
    workspaceId: ws1,
    rootId: prdInProgress,
    parentId: prdInProgress,
    revision: 2,
    title: "Activity log viewer command — with pagination and JSON export",
    context:
      "Revision of r1 to fold in pagination and JSON export that were deferred during initial implementation.",
    scope: "Adds: --page flag, --json flag. Inherits all scope from r1. Excludes: interactive TUI.",
    status: "in_progress",
    createdAt: ago(7),
    updatedAt: ago(1),
    readyAt: ago(6),
    activatedAt: ago(5),
  },
  {
    id: prdCanceled,
    projectId: proj1,
    workspaceId: null,
    rootId: prdCanceled,
    parentId: null,
    revision: 1,
    title: "Remote sync via S3",
    context: "Explored syncing depot.db to S3 for multi-machine access.",
    scope: "Canceled — local-first constraint makes this out of scope for v2.",
    status: "canceled",
    createdAt: ago(30),
    updatedAt: ago(25),
    readyAt: null,
    activatedAt: null,
  },
  {
    id: prdDraftNoTasks,
    projectId: proj1,
    workspaceId: null,
    rootId: prdDraftNoTasks,
    parentId: null,
    revision: 1,
    title: "Telemetry opt-in flag",
    context: "Add an opt-in flag for anonymous usage telemetry to guide roadmap decisions.",
    scope: null,
    status: "draft",
    createdAt: ago(2),
    updatedAt: ago(2),
    readyAt: null,
    activatedAt: null,
  },
  {
    id: prdDone,
    projectId: proj2,
    workspaceId: ws2,
    rootId: prdDone,
    parentId: null,
    revision: 1,
    title: "PRD detail page",
    context: "The web UI needs a dedicated page to display a single PRD with its full task list.",
    scope: "Includes: route, task list, status badges, review summary. Excludes: editing.",
    status: "done",
    createdAt: ago(35),
    updatedAt: ago(22),
    readyAt: ago(33),
    activatedAt: ago(30),
  },
  {
    id: prdDoneV1,
    projectId: proj3,
    workspaceId: ws3,
    rootId: prdDoneV1,
    parentId: null,
    revision: 1,
    title: "Import v1 task files",
    context: "Batch-import all v1 flat YAML task files into depot SQLite.",
    scope: "Includes: parser, DB insert, duplicate detection. Excludes: validation rules.",
    status: "done",
    createdAt: ago(85),
    updatedAt: ago(60),
    readyAt: ago(84),
    activatedAt: ago(82),
  },
  {
    id: prdDoneV2,
    projectId: proj3,
    workspaceId: ws3,
    rootId: prdDoneV1,
    parentId: prdDoneV1,
    revision: 2,
    title: "Import v1 task files — with status normalisation",
    context: "Fork of v1 to add status normalisation discovered post-import.",
    scope: "Adds: status normalisation pass. Inherits scope from v1.",
    status: "done",
    createdAt: ago(58),
    updatedAt: ago(25),
    readyAt: ago(57),
    activatedAt: ago(55),
  },
  {
    id: prdDoneV3,
    projectId: proj3,
    workspaceId: ws3,
    rootId: prdDoneV1,
    parentId: prdDoneV2,
    revision: 3,
    title: "Import v1 task files — with full audit trail",
    context:
      "Third revision to add a per-row audit log for every status change applied during normalisation.",
    scope: "Adds: audit log insert per updated row, CSV export of changes. Inherits scope from r2.",
    status: "done",
    createdAt: ago(22),
    updatedAt: ago(8),
    readyAt: ago(21),
    activatedAt: ago(20),
  },
]);

// ── Reviews ───────────────────────────────────────────────────────────────────

const revHumanDraft = id();
const revAgentDone = id();
const revHumanDone = id();
const revAgentInProgress = id();

await db.insert(schema.reviews).values([
  {
    id: revAgentDone,
    prdId: prdInProgress,
    type: "agent",
    status: "done",
    userFeedback: null,
    createdAt: ago(14),
    updatedAt: ago(12),
    doneAt: ago(12),
  },
  {
    id: revHumanDraft,
    prdId: prdInProgress,
    type: "human",
    status: "draft",
    userFeedback: null,
    createdAt: ago(10),
    updatedAt: ago(10),
    doneAt: null,
  },
  {
    id: revHumanDone,
    prdId: prdDone,
    type: "human",
    status: "done",
    userFeedback:
      "Looks good. The task list covers all acceptance criteria. Minor nit on badge spacing — not blocking.",
    createdAt: ago(28),
    updatedAt: ago(23),
    doneAt: ago(23),
  },
  {
    id: revAgentInProgress,
    prdId: prdDoneV2,
    type: "agent",
    status: "in_progress",
    userFeedback: null,
    createdAt: ago(26),
    updatedAt: ago(24),
    doneAt: null,
  },
]);

// ── Tasks ─────────────────────────────────────────────────────────────────────
// Pre-assign IDs for tasks that will have activity_log entries.

const taskSchema = id();
const taskLogCmd = id();
const taskRoute = id();
const taskBuildList = id();
const taskParseYaml = id();
const taskInsertDb = id();
const taskDetectStatus = id();
const taskNormalise = id();

await db.insert(schema.tasks).values([
  // ── prdInProgress ────────────────────────────────────────────────────────────
  {
    id: taskSchema,
    prdId: prdInProgress,
    position: 1,
    title: "Design activity log schema",
    description: `Intent:
Add the activity_log table to schema.ts with an eventType column, FK columns for project/prd/task/workspace, and a JSON payload field. Generate and apply the Drizzle migration.

Scope:
- Add activity_log table definition to src/db/schema.ts
- Add FK indexes for project_id, workspace_id, prd_id, task_id
- Define relations in the existing defineRelations call
- Generate migration with bun run db:generate and apply it

Non-goals:
- Activity log CLI commands (separate PRD)
- Web UI rendering (separate task)`,
    descriptionFormat: "structured_v1",
    doneCriteria: "Migration generated and applied. Schema reviewed.",
    dependsOn: "[]",
    effort: "s",
    status: "done",
    reviewId: null,
    severity: null,
    blockedReason: null,
    skipReason: null,
    createdAt: ago(15),
    startedAt: ago(15),
    completedAt: ago(13),
  },
  {
    id: taskLogCmd,
    prdId: prdInProgress,
    position: 2,
    title: "Implement `depot log` command",
    description: `Intent:
Wire up a new citty subcommand \`depot log\` that queries activity_log with optional --prd, --task, and --limit filters and prints rows as an aligned table with kleur colours.

Scope:
- Create src/cli/commands/log.ts with the citty command definition
- Query activity_log table respecting --prd, --task, --limit flags
- Format output as an aligned table using kleur for colour

Non-goals:
- Pagination (separate task)
- JSON export flag (separate PRD)`,
    descriptionFormat: "structured_v1",
    doneCriteria: "`depot log` prints entries. `--prd`, `--task`, `--limit` flags work.",
    dependsOn: "[]",
    effort: "m",
    status: "in_progress",
    reviewId: null,
    severity: null,
    blockedReason: null,
    skipReason: null,
    createdAt: ago(13),
    startedAt: ago(11),
    completedAt: null,
  },
  {
    id: id(),
    prdId: prdInProgress,
    position: 3,
    title: "Add pagination to log output",
    description: "Support --page and --limit flags for navigating large logs.",
    descriptionFormat: "plain",
    doneCriteria: "Pagination flags work. Empty page shows friendly message.",
    dependsOn: "[]",
    effort: "s",
    status: "pending",
    reviewId: null,
    severity: null,
    blockedReason: null,
    skipReason: null,
    createdAt: ago(13),
    startedAt: null,
    completedAt: null,
  },
  {
    id: id(),
    prdId: prdInProgress,
    position: 4,
    title: "Write integration tests for log command",
    description: "Cover happy path, empty log, and all filter combinations.",
    descriptionFormat: "plain",
    doneCriteria: "Tests pass in CI. Coverage ≥ 80% for log module.",
    dependsOn: "[]",
    effort: "m",
    status: "blocked",
    reviewId: null,
    severity: null,
    blockedReason: "Waiting on pagination implementation to be stable before writing tests.",
    skipReason: null,
    createdAt: ago(12),
    startedAt: null,
    completedAt: null,
  },
  {
    id: id(),
    prdId: prdInProgress,
    position: 5,
    title: "Add JSON export flag to log command",
    description: "Support `--json` flag that emits raw JSON array for piping.",
    descriptionFormat: "plain",
    doneCriteria: "`depot log --json` outputs valid JSON.",
    dependsOn: "[]",
    effort: "xs",
    status: "skipped",
    reviewId: null,
    severity: null,
    blockedReason: null,
    skipReason: "Out of scope for initial release — deferred to a follow-up PRD.",
    createdAt: ago(12),
    startedAt: null,
    completedAt: null,
  },

  // ── prdReady ─────────────────────────────────────────────────────────────────
  {
    id: id(),
    prdId: prdReady,
    position: 1,
    title: "Define structured_v2 JSON schema",
    description: "Spec out the new format with sub-items and code-block support.",
    descriptionFormat: "plain",
    doneCriteria: "Schema documented in docs/. Validated with zod.",
    dependsOn: "[]",
    effort: "s",
    status: "pending",
    reviewId: null,
    severity: null,
    blockedReason: null,
    skipReason: null,
    createdAt: ago(3),
    startedAt: null,
    completedAt: null,
  },
  {
    id: id(),
    prdId: prdReady,
    position: 2,
    title: "Implement v2 renderer in CLI",
    description: "Update `depot context` to render structured_v2 tasks.",
    descriptionFormat: "plain",
    doneCriteria: "All context modes render v2 tasks correctly.",
    dependsOn: "[]",
    effort: "m",
    status: "pending",
    reviewId: null,
    severity: null,
    blockedReason: null,
    skipReason: null,
    createdAt: ago(3),
    startedAt: null,
    completedAt: null,
  },
  {
    id: id(),
    prdId: prdReady,
    position: 3,
    title: "Migration: backfill existing tasks to structured_v1",
    description: "Ensure all existing plain-format tasks are tagged correctly.",
    descriptionFormat: "plain",
    doneCriteria: "Zero tasks with null descriptionFormat after migration.",
    dependsOn: "[]",
    effort: "xs",
    status: "pending",
    reviewId: null,
    severity: null,
    blockedReason: null,
    skipReason: null,
    createdAt: ago(3),
    startedAt: null,
    completedAt: null,
  },

  // ── prdDone ──────────────────────────────────────────────────────────────────
  {
    id: taskRoute,
    prdId: prdDone,
    position: 1,
    title: "Create /prds/:id route",
    description: `Intent:
Add a TanStack Router file-based route for the PRD detail page so navigating to /prds/:id resolves the correct PRD data or shows a 404.

Scope:
- Create src/web/routes/prds.$id.tsx with createFileRoute
- Add a loader that calls prdsQuery.detail.ensureQueryData
- Throw notFound() for unknown IDs
- Add GET /api/prds/:id endpoint to src/web/api/prds.ts

Non-goals:
- PRD editing or mutation from the web UI
- Task mutation`,
    descriptionFormat: "structured_v1",
    doneCriteria: "Route resolves. 404 on unknown ID.",
    dependsOn: "[]",
    effort: "s",
    status: "done",
    reviewId: revHumanDone,
    severity: "info",
    blockedReason: null,
    skipReason: null,
    createdAt: ago(30),
    startedAt: ago(29),
    completedAt: ago(26),
  },
  {
    id: taskBuildList,
    prdId: prdDone,
    position: 2,
    title: "Build task list component",
    description: `Intent:
Build a reusable TaskCard component that renders a single task row with a status icon, status badge, effort chip, and title. Use it to render the task list on the PRD detail page.

Scope:
- Create src/web/components/task-card.tsx
- Show status icon, StatusBadge, position chip, title, and effort
- Handle all five statuses (pending, in_progress, blocked, done, skipped) with correct icon and colour
- Wire TaskCard into the PRD detail page task list

Non-goals:
- Inline task editing
- Drag-and-drop reordering`,
    descriptionFormat: "structured_v1",
    doneCriteria: "All task statuses render correctly. Empty state handled.",
    dependsOn: "[]",
    effort: "m",
    status: "done",
    reviewId: revHumanDone,
    severity: "minor",
    blockedReason: null,
    skipReason: null,
    createdAt: ago(30),
    startedAt: ago(28),
    completedAt: ago(24),
  },
  {
    id: id(),
    prdId: prdDone,
    position: 3,
    title: "Add review summary section",
    description: "Show latest review status, type, and user feedback on PRD detail page.",
    descriptionFormat: "plain",
    doneCriteria: "Review section visible. No review = section hidden.",
    dependsOn: "[]",
    effort: "s",
    status: "done",
    reviewId: null,
    severity: null,
    blockedReason: null,
    skipReason: null,
    createdAt: ago(30),
    startedAt: ago(25),
    completedAt: ago(22),
  },

  // ── prdDoneV1 ────────────────────────────────────────────────────────────────
  {
    id: taskParseYaml,
    prdId: prdDoneV1,
    position: 1,
    title: "Parse YAML task files",
    description: `Intent:
Read all .task.yml files from the v1 legacy directory tree and parse them into a normalised in-memory structure ready for database insertion.

Scope:
- Scan ./legacy recursively for *.task.yml files
- Parse each file with js-yaml
- Validate required fields: title, status
- Collect parse errors for manual fixup before insertion

Non-goals:
- Database insertion (separate task)
- Status normalisation (separate PRD)`,
    descriptionFormat: "structured_v1",
    doneCriteria: "All files parsed without error. Count matches directory listing.",
    dependsOn: "[]",
    effort: "s",
    status: "done",
    reviewId: null,
    severity: null,
    blockedReason: null,
    skipReason: null,
    createdAt: ago(82),
    startedAt: ago(82),
    completedAt: ago(80),
  },
  {
    id: taskInsertDb,
    prdId: prdDoneV1,
    position: 2,
    title: "Insert tasks into SQLite",
    description: "Batch-insert parsed tasks; skip duplicates on id collision.",
    descriptionFormat: "plain",
    doneCriteria: "Row count equals parsed count. No FK errors.",
    dependsOn: "[]",
    effort: "m",
    status: "done",
    reviewId: null,
    severity: null,
    blockedReason: null,
    skipReason: null,
    createdAt: ago(80),
    startedAt: ago(80),
    completedAt: ago(75),
  },

  // ── prdDoneV2 ────────────────────────────────────────────────────────────────
  {
    id: taskDetectStatus,
    prdId: prdDoneV2,
    position: 1,
    title: "Detect non-standard status strings",
    description: "Scan imported tasks for status values not in VALID_TASK_STATUSES.",
    descriptionFormat: "plain",
    doneCriteria: "Report lists all offending rows with their raw status value.",
    dependsOn: "[]",
    effort: "xs",
    status: "done",
    reviewId: null,
    severity: null,
    blockedReason: null,
    skipReason: null,
    createdAt: ago(55),
    startedAt: ago(55),
    completedAt: ago(53),
  },
  {
    id: taskNormalise,
    prdId: prdDoneV2,
    position: 2,
    title: "Normalise status values",
    description: "Map legacy statuses to canonical ones and update rows in-place.",
    descriptionFormat: "plain",
    doneCriteria: "Zero tasks with invalid status after normalisation pass.",
    dependsOn: "[]",
    effort: "s",
    status: "done",
    reviewId: null,
    severity: null,
    blockedReason: null,
    skipReason: null,
    createdAt: ago(53),
    startedAt: ago(52),
    completedAt: ago(30),
  },

  // ── prdDraft ─────────────────────────────────────────────────────────────────
  {
    id: id(),
    prdId: prdDraft,
    position: 1,
    title: "Design plugin registry interface",
    description: "Sketch the TypeScript interface that plugins must implement.",
    descriptionFormat: "plain",
    doneCriteria: "Interface defined in src/types. At least one example plugin stub written.",
    dependsOn: "[]",
    effort: "m",
    status: "pending",
    reviewId: null,
    severity: null,
    blockedReason: null,
    skipReason: null,
    createdAt: ago(1),
    startedAt: null,
    completedAt: null,
  },
  {
    id: id(),
    prdId: prdDraft,
    position: 2,
    title: "Prototype plugin loader",
    description: "Load plugins from a configurable directory at startup.",
    descriptionFormat: "plain",
    doneCriteria: "Loader resolves plugins. Unknown paths log a warning.",
    dependsOn: "[]",
    effort: "l",
    status: "pending",
    reviewId: null,
    severity: null,
    blockedReason: null,
    skipReason: null,
    createdAt: ago(1),
    startedAt: null,
    completedAt: null,
  },
  {
    id: id(),
    prdId: prdDraft,
    position: 3,
    title: "Document plugin authoring guide",
    description: "Write a guide in docs/ explaining how to author and register a plugin.",
    descriptionFormat: "plain",
    doneCriteria: "Guide published. Example plugin included.",
    dependsOn: "[]",
    effort: "s",
    status: "pending",
    reviewId: null,
    severity: null,
    blockedReason: null,
    skipReason: null,
    createdAt: ago(1),
    startedAt: null,
    completedAt: null,
  },

  // ── prdInProgressV2 ──────────────────────────────────────────────────────────
  {
    id: id(),
    prdId: prdInProgressV2,
    position: 1,
    title: "Add --page and --limit flags for pagination",
    description: "Support paginated output for `depot log` with --page and --limit flags.",
    descriptionFormat: "plain",
    doneCriteria: "--page and --limit flags work. Empty page shows a friendly message.",
    dependsOn: "[]",
    effort: "s",
    status: "in_progress",
    reviewId: null,
    severity: null,
    blockedReason: null,
    skipReason: null,
    createdAt: ago(5),
    startedAt: ago(3),
    completedAt: null,
  },
  {
    id: id(),
    prdId: prdInProgressV2,
    position: 2,
    title: "Add --json export flag",
    description: "Support `--json` flag that emits a raw JSON array for piping to other tools.",
    descriptionFormat: "plain",
    doneCriteria: "`depot log --json` outputs valid JSON. Piping to `jq` works.",
    dependsOn: "[]",
    effort: "xs",
    status: "pending",
    reviewId: null,
    severity: null,
    blockedReason: null,
    skipReason: null,
    createdAt: ago(5),
    startedAt: null,
    completedAt: null,
  },
  {
    id: id(),
    prdId: prdInProgressV2,
    position: 3,
    title: "Update integration tests for pagination and JSON",
    description: "Extend existing log command tests to cover the new flags and edge cases.",
    descriptionFormat: "plain",
    doneCriteria: "All flag combinations covered. Tests pass in CI.",
    dependsOn: "[]",
    effort: "s",
    status: "pending",
    reviewId: null,
    severity: null,
    blockedReason: null,
    skipReason: null,
    createdAt: ago(5),
    startedAt: null,
    completedAt: null,
  },

  // ── prdDoneV3 ─────────────────────────────────────────────────────────────────
  {
    id: id(),
    prdId: prdDoneV3,
    position: 1,
    title: "Add audit log entry per status update",
    description:
      "Insert one audit_log row for every task row updated during the normalisation pass.",
    descriptionFormat: "plain",
    doneCriteria: "audit_log table populated after normalise run. Row count equals updated tasks.",
    dependsOn: "[]",
    effort: "s",
    status: "done",
    reviewId: null,
    severity: null,
    blockedReason: null,
    skipReason: null,
    createdAt: ago(20),
    startedAt: ago(20),
    completedAt: ago(17),
  },
  {
    id: id(),
    prdId: prdDoneV3,
    position: 2,
    title: "Export audit report to CSV",
    description:
      "Write a script that reads audit_log and emits a CSV report of all status changes.",
    descriptionFormat: "plain",
    doneCriteria:
      "CSV file generated with correct columns. Empty audit log produces header-only CSV.",
    dependsOn: "[]",
    effort: "xs",
    status: "done",
    reviewId: null,
    severity: null,
    blockedReason: null,
    skipReason: null,
    createdAt: ago(17),
    startedAt: ago(16),
    completedAt: ago(10),
  },
]);

// ── Activity log ──────────────────────────────────────────────────────────────
// Payload conventions:
//   task_started  → { message: string }
//   note          → { kind: "terminal", lines: [{ text, type: "command"|"output" }] }
//   task_done     → { files: [{ path, added, removed }] }

await db.insert(schema.activityLog).values([
  // ── taskSchema (done): Design activity log schema ────────────────────────────
  {
    projectId: proj1,
    workspaceId: ws1,
    prdId: prdInProgress,
    taskId: taskSchema,
    eventType: "task_started",
    payload: JSON.stringify({ message: "Starting task: Design activity log schema" }),
    createdAt: ago(15, 8),
  },
  {
    projectId: proj1,
    workspaceId: ws1,
    prdId: prdInProgress,
    taskId: taskSchema,
    eventType: "note",
    payload: terminalPayload([
      { text: "$ cat src/db/schema.ts | grep -n 'Table'", type: "command" },
      { text: "16: export const projects = sqliteTable('projects', {", type: "output" },
      { text: "34: export const workspaces = sqliteTable('workspaces', {", type: "output" },
      { text: "56: export const prds = sqliteTable('prds', {", type: "output" },
      { text: "115: export const tasks = sqliteTable('tasks', {", type: "output" },
      { text: "", type: "output" },
      { text: "$ # Adding activity_log table to schema.ts", type: "command" },
    ]),
    createdAt: ago(15, 7),
  },
  {
    projectId: proj1,
    workspaceId: ws1,
    prdId: prdInProgress,
    taskId: taskSchema,
    eventType: "note",
    payload: terminalPayload([
      { text: "$ bun run db:generate", type: "command" },
      { text: "No config path provided, using default 'drizzle.config.ts'", type: "output" },
      { text: "Reading config file '/home/user/projects/depot/drizzle.config.ts'", type: "output" },
      { text: "1 tables changed:", type: "output" },
      { text: "  + activity_log (8 columns, 4 indexes, 4 foreign keys)", type: "output" },
      { text: "", type: "output" },
      {
        text: "Your SQL migration file ➜ src/db/migrations/20260423112052_.../migration.sql",
        type: "output",
      },
    ]),
    createdAt: ago(15, 6),
  },
  {
    projectId: proj1,
    workspaceId: ws1,
    prdId: prdInProgress,
    taskId: taskSchema,
    eventType: "note",
    payload: terminalPayload([
      { text: "$ bun run db:migrate", type: "command" },
      { text: "No config path provided, using default 'drizzle.config.ts'", type: "output" },
      { text: "Running migrations...", type: "output" },
      { text: "  ✓ 20260423112052_acoustic_mulholland_black", type: "output" },
      { text: "All migrations ran successfully.", type: "output" },
      { text: "", type: "output" },
      { text: "$ bun run typecheck", type: "command" },
      { text: "Found 0 errors.", type: "output" },
    ]),
    createdAt: ago(13, 4),
  },
  {
    projectId: proj1,
    workspaceId: ws1,
    prdId: prdInProgress,
    taskId: taskSchema,
    eventType: "task_done",
    payload: donePayload([
      { path: "src/db/schema.ts", added: 28, removed: 0 },
      { path: "src/db/migrations/20260423112052_.../migration.sql", added: 35, removed: 0 },
      { path: "src/shared/validator.ts", added: 12, removed: 0 },
    ]),
    createdAt: ago(13, 3),
  },

  // ── taskLogCmd (in_progress): Implement depot log command ────────────────────
  {
    projectId: proj1,
    workspaceId: ws1,
    prdId: prdInProgress,
    taskId: taskLogCmd,
    eventType: "task_started",
    payload: JSON.stringify({ message: "Starting task: Implement `depot log` command" }),
    createdAt: ago(11, 6),
  },
  {
    projectId: proj1,
    workspaceId: ws1,
    prdId: prdInProgress,
    taskId: taskLogCmd,
    eventType: "note",
    payload: terminalPayload([
      { text: "$ ls src/cli/commands/", type: "command" },
      { text: "context.ts  prd.ts  serve.ts  task.ts", type: "output" },
      { text: "", type: "output" },
      { text: "$ touch src/cli/commands/log.ts", type: "command" },
      { text: "$ # Scaffolding citty command definition", type: "command" },
    ]),
    createdAt: ago(11, 5),
  },
  {
    projectId: proj1,
    workspaceId: ws1,
    prdId: prdInProgress,
    taskId: taskLogCmd,
    eventType: "note",
    payload: terminalPayload([
      { text: "$ bun run depot -- log --help", type: "command" },
      { text: "Usage: depot log [options]", type: "output" },
      { text: "", type: "output" },
      { text: "Options:", type: "output" },
      { text: "  --prd <id>      Filter by PRD id", type: "output" },
      { text: "  --task <id>     Filter by task id", type: "output" },
      { text: "  --limit <n>     Max entries to show (default: 50)", type: "output" },
      { text: "  -h, --help      Show this help", type: "output" },
    ]),
    createdAt: ago(11, 3),
  },
  {
    projectId: proj1,
    workspaceId: ws1,
    prdId: prdInProgress,
    taskId: taskLogCmd,
    eventType: "note",
    payload: terminalPayload([
      { text: "$ bun run depot -- log --limit 5", type: "command" },
      { text: "EVENT          PRD          TASK         AT", type: "output" },
      { text: "─────────────────────────────────────────────────────────────", type: "output" },
      { text: "task_started   01JRVB...    01JRVC...    2 hours ago", type: "output" },
      { text: "note           01JRVB...    01JRVC...    2 hours ago", type: "output" },
      { text: "task_done      01JRVB...    01JRVA...    13 days ago", type: "output" },
      { text: "", type: "output" },
      { text: "$ bun run test src/cli/commands/log.test.ts", type: "command" },
      {
        text: "FAIL src/cli/commands/log.test.ts — --prd filter not yet implemented",
        type: "output",
      },
    ]),
    createdAt: ago(2, 2),
  },

  // ── taskRoute (done): Create /prds/:id route ─────────────────────────────────
  {
    projectId: proj2,
    workspaceId: ws2,
    prdId: prdDone,
    taskId: taskRoute,
    eventType: "task_started",
    payload: JSON.stringify({ message: "Starting task: Create /prds/:id route" }),
    createdAt: ago(29, 8),
  },
  {
    projectId: proj2,
    workspaceId: ws2,
    prdId: prdDone,
    taskId: taskRoute,
    eventType: "note",
    payload: terminalPayload([
      { text: "$ ls src/web/routes/", type: "command" },
      { text: "__root.tsx  index.tsx", type: "output" },
      { text: "", type: "output" },
      { text: "$ touch src/web/routes/prds.\\$id.tsx", type: "command" },
      { text: "$ touch src/web/routes/prds.\\$id.index.tsx", type: "command" },
      { text: "$ # Adding createFileRoute + loader + notFound guard", type: "command" },
    ]),
    createdAt: ago(29, 7),
  },
  {
    projectId: proj2,
    workspaceId: ws2,
    prdId: prdDone,
    taskId: taskRoute,
    eventType: "note",
    payload: terminalPayload([
      { text: "$ bun run dev:web", type: "command" },
      { text: "  VITE v8.0.8  ready in 312 ms", type: "output" },
      { text: "  ➜  Local:   http://localhost:5173/", type: "output" },
      { text: "", type: "output" },
      { text: "$ curl -s http://localhost:5173/api/prds/INVALID | jq .error", type: "command" },
      { text: '"Not found"', type: "output" },
      { text: "", type: "output" },
      { text: "$ curl -s http://localhost:5173/api/prds | jq '.prds | length'", type: "command" },
      { text: "3", type: "output" },
    ]),
    createdAt: ago(26, 3),
  },
  {
    projectId: proj2,
    workspaceId: ws2,
    prdId: prdDone,
    taskId: taskRoute,
    eventType: "task_done",
    payload: donePayload([
      { path: "src/web/routes/prds.$id.tsx", added: 18, removed: 0 },
      { path: "src/web/routes/prds.$id.index.tsx", added: 62, removed: 0 },
      { path: "src/web/api/prds.ts", added: 22, removed: 4 },
      { path: "src/web/lib/queries.ts", added: 14, removed: 1 },
    ]),
    createdAt: ago(26, 2),
  },

  // ── taskBuildList (done): Build task list component ──────────────────────────
  {
    projectId: proj2,
    workspaceId: ws2,
    prdId: prdDone,
    taskId: taskBuildList,
    eventType: "task_started",
    payload: JSON.stringify({ message: "Starting task: Build task list component" }),
    createdAt: ago(28, 6),
  },
  {
    projectId: proj2,
    workspaceId: ws2,
    prdId: prdDone,
    taskId: taskBuildList,
    eventType: "note",
    payload: terminalPayload([
      { text: "$ touch src/web/components/task-card.tsx", type: "command" },
      { text: "$ # Implementing TaskCard with StatusBadge + effort chip", type: "command" },
      { text: "", type: "output" },
      { text: "$ bun run typecheck 2>&1 | tail -5", type: "command" },
      {
        text: "  error TS2322: Type 'string' is not assignable to type 'TaskStatus'",
        type: "output",
      },
      { text: "  src/web/components/task-card.tsx:35:18", type: "output" },
      { text: "", type: "output" },
      { text: "$ # Fixing — adding type guard for unknown status values", type: "command" },
    ]),
    createdAt: ago(28, 5),
  },
  {
    projectId: proj2,
    workspaceId: ws2,
    prdId: prdDone,
    taskId: taskBuildList,
    eventType: "note",
    payload: terminalPayload([
      { text: "$ bun run typecheck", type: "command" },
      { text: "Found 0 errors.", type: "output" },
      { text: "", type: "output" },
      { text: "$ bun run build:web 2>&1 | tail -3", type: "command" },
      { text: "dist/web/assets/index.css    38.91 kB │ gzip: 7.61 kB", type: "output" },
      { text: "dist/web/assets/index.js    371.44 kB │ gzip: 114.22 kB", type: "output" },
      { text: "✓ built in 441ms", type: "output" },
    ]),
    createdAt: ago(24, 2),
  },
  {
    projectId: proj2,
    workspaceId: ws2,
    prdId: prdDone,
    taskId: taskBuildList,
    eventType: "task_done",
    payload: donePayload([
      { path: "src/web/components/task-card.tsx", added: 71, removed: 0 },
      { path: "src/web/components/ui/status-badge.tsx", added: 32, removed: 8 },
      { path: "src/web/routes/prds.$id.index.tsx", added: 18, removed: 3 },
    ]),
    createdAt: ago(24, 1),
  },

  // ── taskParseYaml (done): Parse YAML task files ──────────────────────────────
  {
    projectId: proj3,
    workspaceId: ws3,
    prdId: prdDoneV1,
    taskId: taskParseYaml,
    eventType: "task_started",
    payload: JSON.stringify({ message: "Starting task: Parse YAML task files" }),
    createdAt: ago(82, 6),
  },
  {
    projectId: proj3,
    workspaceId: ws3,
    prdId: prdDoneV1,
    taskId: taskParseYaml,
    eventType: "note",
    payload: terminalPayload([
      { text: "$ find ./legacy -name '*.task.yml' | wc -l", type: "command" },
      { text: "147", type: "output" },
      { text: "", type: "output" },
      { text: "$ bun scripts/parse-yaml.ts --dry-run", type: "command" },
      { text: "Scanning ./legacy...", type: "output" },
      { text: "  Parsed 147 files", type: "output" },
      { text: "  3 files had parse errors:", type: "output" },
      { text: "    legacy/2024-01/task-0042.yml — missing 'title' field", type: "output" },
      { text: "    legacy/2024-03/task-0118.yml — invalid YAML syntax at line 7", type: "output" },
      { text: "    legacy/2024-05/task-0201.yml — unknown status 'wip'", type: "output" },
    ]),
    createdAt: ago(82, 5),
  },
  {
    projectId: proj3,
    workspaceId: ws3,
    prdId: prdDoneV1,
    taskId: taskParseYaml,
    eventType: "note",
    payload: terminalPayload([
      { text: "$ # Fixing parse errors manually, then re-running", type: "command" },
      { text: "$ bun scripts/parse-yaml.ts --dry-run", type: "command" },
      { text: "Scanning ./legacy...", type: "output" },
      { text: "  Parsed 147 files — 0 errors", type: "output" },
      { text: "  Ready to insert.", type: "output" },
    ]),
    createdAt: ago(80, 4),
  },
  {
    projectId: proj3,
    workspaceId: ws3,
    prdId: prdDoneV1,
    taskId: taskParseYaml,
    eventType: "task_done",
    payload: donePayload([
      { path: "scripts/parse-yaml.ts", added: 88, removed: 0 },
      { path: "scripts/legacy-fixups.json", added: 3, removed: 0 },
    ]),
    createdAt: ago(80, 3),
  },

  // ── taskInsertDb (done): Insert tasks into SQLite ────────────────────────────
  {
    projectId: proj3,
    workspaceId: ws3,
    prdId: prdDoneV1,
    taskId: taskInsertDb,
    eventType: "task_started",
    payload: JSON.stringify({ message: "Starting task: Insert tasks into SQLite" }),
    createdAt: ago(80, 2),
  },
  {
    projectId: proj3,
    workspaceId: ws3,
    prdId: prdDoneV1,
    taskId: taskInsertDb,
    eventType: "note",
    payload: terminalPayload([
      { text: "$ bun scripts/import.ts --input ./legacy --db ~/.depot/depot.db", type: "command" },
      { text: "Opening database at ~/.depot/depot.db...", type: "output" },
      { text: "Inserting 147 tasks...", type: "output" },
      { text: "  [====================] 147/147", type: "output" },
      { text: "  0 duplicates skipped", type: "output" },
      { text: "  0 FK errors", type: "output" },
      { text: "Done. 147 tasks imported.", type: "output" },
    ]),
    createdAt: ago(75, 4),
  },
  {
    projectId: proj3,
    workspaceId: ws3,
    prdId: prdDoneV1,
    taskId: taskInsertDb,
    eventType: "task_done",
    payload: donePayload([{ path: "scripts/import.ts", added: 54, removed: 0 }]),
    createdAt: ago(75, 3),
  },

  // ── taskDetectStatus (done): Detect non-standard status strings ──────────────
  {
    projectId: proj3,
    workspaceId: ws3,
    prdId: prdDoneV2,
    taskId: taskDetectStatus,
    eventType: "task_started",
    payload: JSON.stringify({ message: "Starting task: Detect non-standard status strings" }),
    createdAt: ago(55, 4),
  },
  {
    projectId: proj3,
    workspaceId: ws3,
    prdId: prdDoneV2,
    taskId: taskDetectStatus,
    eventType: "note",
    payload: terminalPayload([
      {
        text: "$ bun -e \"import {Database} from 'bun:sqlite'; const db = new Database('~/.depot/depot.db'); const rows = db.query(\\\"SELECT DISTINCT status FROM tasks\\\").all(); console.log(rows)\"",
        type: "command",
      },
      {
        text: "[ { status: 'done' }, { status: 'pending' }, { status: 'wip' }, { status: 'in-progress' }, { status: 'blocked' } ]",
        type: "output",
      },
      { text: "", type: "output" },
      { text: "Found 2 non-standard values: 'wip', 'in-progress'", type: "output" },
    ]),
    createdAt: ago(53, 3),
  },
  {
    projectId: proj3,
    workspaceId: ws3,
    prdId: prdDoneV2,
    taskId: taskDetectStatus,
    eventType: "task_done",
    payload: donePayload([{ path: "scripts/detect-status.ts", added: 21, removed: 0 }]),
    createdAt: ago(53, 2),
  },

  // ── taskNormalise (done): Normalise status values ────────────────────────────
  {
    projectId: proj3,
    workspaceId: ws3,
    prdId: prdDoneV2,
    taskId: taskNormalise,
    eventType: "task_started",
    payload: JSON.stringify({ message: "Starting task: Normalise status values" }),
    createdAt: ago(52, 6),
  },
  {
    projectId: proj3,
    workspaceId: ws3,
    prdId: prdDoneV2,
    taskId: taskNormalise,
    eventType: "note",
    payload: terminalPayload([
      { text: "$ bun scripts/normalise-status.ts --dry-run", type: "command" },
      { text: "Would update 12 rows:", type: "output" },
      { text: "  'wip'         → 'in_progress'  (9 rows)", type: "output" },
      { text: "  'in-progress' → 'in_progress'  (3 rows)", type: "output" },
      { text: "", type: "output" },
      { text: "$ bun scripts/normalise-status.ts --apply", type: "command" },
      { text: "Updated 12 rows.", type: "output" },
      { text: "", type: "output" },
      { text: '$ bun -e "..." # re-check distinct statuses', type: "command" },
      {
        text: "[ { status: 'done' }, { status: 'pending' }, { status: 'in_progress' }, { status: 'blocked' } ]",
        type: "output",
      },
      { text: "All statuses are now canonical. ✓", type: "output" },
    ]),
    createdAt: ago(30, 4),
  },
  {
    projectId: proj3,
    workspaceId: ws3,
    prdId: prdDoneV2,
    taskId: taskNormalise,
    eventType: "task_done",
    payload: donePayload([{ path: "scripts/normalise-status.ts", added: 38, removed: 0 }]),
    createdAt: ago(30, 3),
  },
]);

client.close();
console.log("Seed complete.");
