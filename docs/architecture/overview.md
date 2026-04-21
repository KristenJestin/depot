# Architecture Overview

This page describes the current implementation shape of `depot`.

## Stack

- Runtime: Bun
- Language: TypeScript with `strict` mode
- CLI framework: `citty`
- Database: SQLite via `bun:sqlite`
- ORM and migrations: Drizzle ORM + Drizzle Kit
- Validation: Zod

## Repository layout

The main code paths are:

- `src/cli/` for command entrypoints and CLI context resolution
- `src/lib/` for workflow logic, validators, logging, schemas, and handoff generation
- `src/db/` for database access, schema, and migrations
- `tests/` for CLI, database, integration, and library coverage

The CLI entrypoint is `src/cli/index.ts`.

## Local database model

The default database path is:

```text
~/.depot/depot.db
```

When `depot` opens the database, it:

- creates `~/.depot/` if needed
- opens SQLite in WAL mode
- enables foreign keys
- applies pending Drizzle migrations automatically

`src/db/schema.ts` is the source of truth for the schema, and generated migrations live under `src/db/migrations/`.

## Workflow engine

Most business rules live in `src/lib/workflow.ts`.

That module currently owns logic such as:

- project creation and lookup
- workspace registration and resolution
- PRD lifecycle operations
- task creation and status transitions
- activity log writes and reads

This keeps command files relatively thin. The CLI commands resolve context, validate input, and then call workflow functions that enforce the actual state rules.

## Workspace resolution

Many commands are workspace-aware rather than purely global.

The current resolution rule is longest-prefix matching on canonical absolute paths. This means commands can run from nested directories inside a registered workspace and still resolve to the correct project context.

## Handoff generation

`src/lib/handoff.ts` turns database state into a readable handoff summary.

The current output is:

- plaintext
- deterministic
- optimized for terminal use
- suitable for copy-pasting into a new agent session

## Current design bias

The implementation today is intentionally:

- local-first
- machine-assisted but human-readable
- deterministic in command behavior
- centered on explicit state transitions rather than implicit chat memory
