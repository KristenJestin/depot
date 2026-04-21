# Architecture Overview

This page describes the current implementation shape of `depot`.

## Stack

- Runtime: Bun
- Language: TypeScript with `strict` mode
- CLI framework: `citty`
- Database: SQLite via `bun:sqlite`
- ORM and migrations: Drizzle ORM + Drizzle Kit
- Validation: Zod
- ID generation: ULID via `ulid`

## Repository layout

```
src/
  cli/
    index.ts           # CLI entrypoint, defines main command and subcommands
    command.ts         # defineValidatedCommand helper (citty + Zod integration)
    output.ts          # JSON envelope helpers (outputSuccess, outputError)
    runtime.ts         # getDb, resolveCurrentWorkspace
    commands/
      project.ts       # init, project list/show/update/archive
      workspace.ts     # workspace list/show/rename/remove
      prd.ts           # prd create/show/list/commit/activate/amend/archive
      task.ts          # task add/list/show/start/done/block/skip
      log.ts           # log add/list
      handoff.ts       # handoff
      context.ts       # context [prd|dev|review]
      install.ts       # install
      review.ts        # review start/show/list/findings/decide/activate
  lib/
    workflow.ts        # All workflow logic and state transitions
    validator.ts       # Valid enums and transition tables
    schemas.ts         # Zod field schemas and validateArgs helper
    handoff.ts         # buildHandoff and buildHandoffData
    agent-context.ts   # renderContextIndex and renderContextMode
    agent-install.ts   # resolveInstallTargets and buildInstallWrites
    contexts.ts        # Embedded template registry (prd.md, dev.md, review.md)
    task-spec.ts       # structured_v1 description parsing and formatting
    workspace-bootstrap.ts # resolveOrCreateWorkspaceForPath
    logger.ts          # log helper, debug flag, json mode flag
    ids.ts             # generateId (ULID)
    paths.ts           # normalizeWorkspacePath
  db/
    schema.ts          # Drizzle schema (source of truth)
    client.ts          # openDatabase, applyMigrations, defaultDbPath
    migrations/        # Generated migration SQL files
  context/
    prd.md             # Embedded PRD agent instructions
    dev.md             # Embedded dev agent instructions
    review.md          # Embedded review agent instructions
  types/
    text.d.ts          # TypeScript declaration for .md with { type: "text" }

tests/
  cli/                 # CLI command integration tests
  lib/                 # Unit tests for lib modules
  db/                  # Database client and migration tests
  integration/         # End-to-end tests
  helpers/             # Shared test utilities
```

The CLI entrypoint is `src/cli/index.ts`.

## Local database model

The default database path is:

```text
~/.depot/depot.db
```

When `depot` opens the database, it:

- creates `~/.depot/` if needed
- opens SQLite in WAL mode with a 5-second busy timeout
- enables foreign keys
- applies pending Drizzle migrations automatically with retry logic for `SQLITE_BUSY` errors

`src/db/schema.ts` is the source of truth for the schema. Generated migrations live under `src/db/migrations/` in source and are published under `dist/migrations/` in the npm package.

## Schema summary

| Table | Primary key | Purpose |
|---|---|---|
| `projects` | ULID | Top-level project container |
| `workspaces` | ULID | Path binding, unique per canonical path |
| `prds` | ULID | PRD lifecycle, supports revision chaining via `parent_id` |
| `tasks` | ULID | Execution units inside a PRD |
| `reviews` | ULID | Review objects attached to a PRD revision |
| `activity_log` | auto-increment integer | Structured event log, linked to project/workspace/prd/task/review |

All timestamps are stored as ISO 8601 strings. IDs are ULIDs.

## Workflow engine

Most business rules live in `src/lib/workflow.ts`.

That module owns:

- project CRUD and status updates
- workspace registration, resolution (longest-prefix matching), label updates, and removal
- PRD lifecycle operations (create, commit, activate, archive, amend)
- task creation and status transitions (with dependency enforcement)
- review CRUD (create, start, record findings, record decision)
- activity log writes and reads
- `buildWorkspaceStatus` — builds a consistent snapshot used by both handoff and context rendering
- `findNextRecommendedTask` — finds the next pending task with all dependencies satisfied
- `summarizeActivityPayload` — produces a human-readable one-line summary for any event type

This keeps command files thin. Commands resolve context, validate input, and delegate to workflow functions that enforce state rules.

## Workspace resolution

Many commands are workspace-aware rather than purely global.

The resolution rule is longest-prefix matching on canonical absolute paths. On Windows, paths are normalized to lowercase forward-slash form before comparison. This ensures commands run from any nested subdirectory resolve to the correct workspace.

`depot context` uses `autoCreate: true`, which silently creates a project and workspace for the current directory if none exists. All other workspace-aware commands require an existing workspace.

## Handoff generation

`src/lib/handoff.ts` builds a structured `HandoffData` object from `buildWorkspaceStatus`, then renders it as deterministic plaintext. The same `HandoffData` type is used for the JSON output path (`--json`).

## Agent contexts and install flow

`src/lib/agent-context.ts` renders the `prd`, `dev`, and `review` context modes. The embedded instruction templates (`src/context/*.md`) are imported at build time as text strings, so the binary is self-contained at runtime.

`src/lib/agent-install.ts` generates slash-command files for OpenCode and Claude Code. Those files do not embed static snapshots; they call `depot context <mode>` at runtime through native shell injection. On Windows the generated shell is `powershell`; on all other platforms it is `bash`.

## Output contracts

The `--json` global flag switches all output to machine-readable mode. In JSON mode, `outputSuccess` emits `{ "kind": "success", "payload": ... }` to stdout, and `outputError` emits `{ "kind": "error", "error": { "code": ..., "message": ... } }` before exiting with code 1. In text mode, `outputError` writes to stderr. See `docs/json-output.md` for the full contract.

## Command validation

`src/cli/command.ts` wraps citty's `defineCommand` with a Zod-validated variant. The schema is applied in both `setup` and `run` hooks. Validation failures print each issue and exit with code 1 (or emit a JSON error envelope in JSON mode).

## Current design bias

The implementation today is intentionally:

- local-first
- machine-assisted but human-readable
- deterministic in command behavior
- centered on explicit state transitions rather than implicit chat memory
