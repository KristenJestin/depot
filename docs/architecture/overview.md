# Architecture Overview

This page describes the current implementation of `depot`.

## Stack

- Source toolchain: Bun + TypeScript
- Runtime target for the bundled CLI: Node `>=25`
- CLI framework: `citty`
- Effects and service wiring: `effect`
- Database: SQLite through `node:sqlite`
- ORM and migrations: Drizzle ORM + Drizzle Kit
- Validation: `effect/Schema`
- ID generation: monotonic ULIDs via `ulid`
- HTTP layer: Hono
- Web UI: React 19, TanStack Router, TanStack Query, Tailwind CSS 4
- Packaging: `vite-plus` with `vp pack` for the CLI bundle and `vp build` for the web app

## Repository Layout

```text
src/
  cli/
    index.ts                # top-level CLI entrypoint
    command.ts              # citty wrapper with Effect/Schema validation
    output.ts               # JSON success/error helpers
    runtime.ts              # shared db/runtime helpers and workspace resolution
    commands/
      projects.ts
      workspaces.ts
      prds.ts
      tasks.ts
      reviews.ts
      activity.ts
      context.ts
      install.ts
      serve.ts

  modules/
    projects/domain.ts      # project operations
    workspaces/domain.ts    # workspace operations and path resolution
    workspaces/bootstrap.ts # auto-create path used by `context`
    prds/domain.ts          # PRD lifecycle and batch loading
    tasks/domain.ts         # task lifecycle and dependency checks
    tasks/spec.ts           # structured task description parsing and formatting
    reviews/domain.ts       # review lifecycle and review tasks
    activity/domain.ts      # activity writes, reads, summaries
    activity/status.ts      # workspace status snapshot used by context rendering
    context/
      index.ts              # embedded template registry
      render.ts             # context renderers
      templates/*.md        # embedded agent instructions
    install/agent.ts        # slash-command file generation

  db/
    client.ts               # sqlite open + migration application
    schema.ts               # source of truth for the schema
    migrations/             # generated drizzle migrations

  services/
    database.ts             # Effect runtime and Db service

  shared/
    validator.ts            # enums and lifecycle transition tables
    schemas.ts              # field schemas and activity payload schemas
    utils.ts                # ids, paths, formatting helpers
    logger.ts               # stdout/stderr and debug/json mode flags
    db.ts
    errors.ts

  lib/
    workflow.ts             # async shim over the Effect domain modules
    json.ts                 # JSON/schema parsing helpers

  web/
    api/                    # Hono API routes
    routes/                 # TanStack Router route files
    components/             # web UI components
    lib/                    # query client, RPC client, formatters
    styles/

tests/
  cli/
  lib/
  web/
  helpers/
```

`src/cli/index.ts` is the user-facing CLI entrypoint. `src/index.ts` simply imports it for the bundle.

## Database Lifecycle

The default database path is:

```text
~/.depot/depot.db
```

You can override that with `DB_PATH`.

When `depot` opens the database, it:

- creates `~/.depot/` if needed
- opens SQLite with WAL mode enabled
- sets a 5-second busy timeout
- enables foreign keys
- applies pending Drizzle migrations automatically
- retries selected migration/open races such as `SQLITE_BUSY`

`src/db/schema.ts` is the source of truth. Generated migrations live in `src/db/migrations/`. The CLI build copies them to `dist/migrations/`.

## Schema Summary

| Table          | Primary key | Purpose                                 |
| -------------- | ----------- | --------------------------------------- |
| `projects`     | text ULID   | top-level project container             |
| `workspaces`   | text ULID   | canonical path binding for a project    |
| `prds`         | text ULID   | PRDs plus revision-family metadata      |
| `reviews`      | text ULID   | human or agent review records for a PRD |
| `tasks`        | text ULID   | execution tasks and review findings     |
| `activity_log` | text ULID   | structured activity events              |

SQLite stores timestamps as `integer` values in `timestamp_ms` mode. Drizzle materializes them as JavaScript `Date` objects, and JSON output serializes them as ISO strings.

## Command Layer

`src/cli/command.ts` is the thin wrapper around `citty`.

It provides three important behaviors:

- argument validation through `effect/Schema`
- a shared output API for text and JSON modes
- optional workspace resolution or workspace auto-creation per command

The command files under `src/cli/commands/` stay intentionally small. They validate inputs, resolve the current workspace when needed, and delegate to domain functions.

## Domain Layer

The actual business rules live in `src/modules/*/domain.ts`.

That layer owns:

- project CRUD and status updates
- workspace registration, label updates, removal, and longest-prefix resolution
- PRD lifecycle transitions and family forking
- task creation, dependency checks, and lifecycle transitions
- review creation, auto-start-on-first-finding behavior, and completion
- activity payload validation and storage

Transition rules are centralized in `src/shared/validator.ts`.

`src/lib/workflow.ts` is not the primary business-logic home. It is a compatibility shim that re-exposes the Effect domain functions to callers that still pass a raw database handle, notably the context renderers and some tests.

## Workspace Resolution

Many commands are workspace-aware rather than purely global.

Resolution uses longest-prefix matching on canonical absolute paths. On Windows, paths are normalized to lowercase forward-slash form before comparison.

That means a workspace registered at:

```text
D:/Projects/depot
```

also resolves commands launched from nested paths such as:

```text
D:/Projects/depot/src/web/routes
```

`depot context` uses `autoCreate: true`. Other workspace-aware commands require a pre-existing workspace.

## Context Rendering

The context system is split into two parts:

- embedded templates in `src/modules/context/templates/*.md`
- renderers in `src/modules/context/render.ts`

The templates are imported as text at build time. The bundle does not read template files from disk at runtime.

The renderer builds context documents from live database state, including PRD summaries, tasks, activity history, review findings, and embedded agent instructions.

## Install Flow

`src/modules/install/agent.ts` generates slash-command files for OpenCode and Claude Code.

Those files do not embed snapshots. They shell out to `depot context prd` or `depot context dev` at invocation time, so the loaded context always reflects the current database state.

On Windows the generated shell is `powershell`. On other platforms it is `bash`.

## Web Interface

`depot serve` starts a Hono server and exposes two layers:

- an API mounted under `/api`
- static assets served from `dist/web`

API routes:

- `GET /api/ping`
- `GET /api/context`
- `GET /api/prds`
- `GET /api/prds/:id`

Web routes:

- `/` lists PRDs
- `/prds/:id` shows PRD details, tasks, and the latest review findings

The frontend is a small read-only UI for now. `bun run build` builds the CLI bundle, while `bun run build:web` builds the static web assets that `serve` expects.

## Build And Packaging

Build outputs are split:

- `bun run build` produces `dist/index.mjs` and `dist/migrations/`
- `bun run build:web` produces `dist/web/`

`vite.config.ts` also contains a raw-text plugin that turns `.md` and `.sql` files into string imports during build, which is how the embedded context templates work.

## Output Contract

The `--json` flag switches supported commands to machine-readable output.

`outputSuccess` writes:

```json
{ "kind": "success", "payload": { ... } }
```

`outputError` writes:

```json
{ "kind": "error", "error": { "code": "...", "message": "..." } }
```

See `docs/json-output.md` for command-level shapes and exclusions.

## Design Bias

The implementation is intentionally:

- local-first
- explicit about state transitions
- thin at the command edge and strict in the domain layer
- human-readable in text mode and machine-readable where JSON mode is supported
- organized so the CLI, the context system, and the web UI all sit on the same stored state
