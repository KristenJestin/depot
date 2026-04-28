# Concepts

`depot` is built around a small, explicit model for tracking agent work locally.

The core idea is not just to store tasks in SQLite. It is to make the moving parts of agent execution explicit enough that a later session, another agent, or a human reviewer can pick up the work without reconstructing state from chat history.

## Projects

A project is the top-level container.

Each project stores:

- a stable text ID generated as a monotonic ULID
- a name
- an optional description
- a status: `active`, `paused`, or `done`

Projects are created indirectly through `depot init` or managed directly with `depot project list`, `depot project show`, `depot project update`, and `depot project archive`.

## Workspaces

A workspace binds a project to a canonical absolute path on disk.

This is how `depot` knows which project you mean when you run workspace-aware commands from a directory. Resolution uses longest-prefix matching on canonical paths, so a command launched from any nested subdirectory still resolves to the correct workspace.

Important properties:

- a workspace belongs to exactly one project
- workspace paths are unique across the database
- a workspace may have an optional human label
- path normalization uses forward slashes, and lowercases paths on Windows

If the current directory does not resolve to a workspace, most workspace-aware commands exit and ask you to run `depot init` first.

`depot context` is the main exception: it uses auto-create mode and silently creates a project plus workspace for the current path before rendering context.

The CLI exposes `depot workspace list`, `depot workspace show`, `depot workspace rename`, and `depot workspace remove`.

## PRDs

A PRD belongs to a project. It captures why a body of work exists and what is in scope.

Before activation, a PRD belongs only to the project. Its `workspaceId` remains `null` until `depot prd activate` attaches it to the current workspace.

The lifecycle is:

- `draft`
- `ready`
- `in_progress`
- `done`
- `canceled`

The validator allows these status transitions:

- `draft -> ready`
- `draft -> canceled`
- `ready -> in_progress`
- `ready -> canceled`
- `in_progress -> done`
- `in_progress -> canceled`

Key behaviors:

- `depot prd create` creates a draft PRD.
- `depot prd update` updates a draft PRD in place.
- `depot prd ready` marks a draft PRD as ready.
- `depot prd activate` moves a ready PRD to `in_progress` and attaches it to the current workspace.
- only one PRD can be `in_progress` in a workspace at a time

### Revisioning

PRDs are revisioned as families.

Each PRD row stores:

- `rootId`: the original revision in the family
- `parentId`: the immediate prior revision
- `revision`: the revision number

The shape is:

```text
v1 : rootId = v1.id, parentId = null,  revision = 1
v2 : rootId = v1.id, parentId = v1.id, revision = 2
v3 : rootId = v1.id, parentId = v2.id, revision = 3
```

Forking is explicit. `depot prd fork <prd-id>` creates a new `draft` revision from a `ready` PRD. The original revision stays `ready`; the fork becomes the new editable branch of the family.

`depot prd list` shows only the latest revision of each family, not every historical row.

### Batch PRD Loading

`depot prd load` creates a PRD and all of its tasks in one SQLite transaction.

The JSON format uses `dependsOn` as zero-based task indexes inside the same document. Only backward references are allowed, so task 4 may depend on task 1, but task 1 may not depend on task 4.

## Tasks

Tasks belong to a PRD and represent concrete execution units.

Each task includes:

- a title
- a description
- required `doneCriteria`
- an effort estimate: `xs`, `s`, `m`, `l`, or `xl`
- an ordered `position` within the PRD
- optional task dependencies stored as a JSON array of task IDs
- an optional `reviewId` when the task is a review finding
- an optional `severity` when the task belongs to a review

New task descriptions are normalized to the `structured_v1` shape:

- `Intent:` why this task exists now
- `Scope:` what should change or be verified
- `Non-goals:` what should not be pulled into the task

Older freeform descriptions remain readable. `depot task show` renders both structured and plain descriptions in a human-readable format.

The task lifecycle is:

- `pending`
- `in_progress`
- `blocked`
- `done`
- `skipped`

Allowed transitions are:

- `pending -> in_progress`
- `pending -> skipped`
- `in_progress -> done`
- `in_progress -> blocked`
- `blocked -> in_progress`
- `blocked -> skipped`

Important behaviors:

- `doneCriteria` must be non-empty
- a task must be started before it can be completed
- a task can only be completed when all dependency tasks are already `done` or `skipped`
- blocking and skipping both require an explicit reason
- review findings are stored in the same `tasks` table as regular execution tasks

## Reviews

A review belongs to a PRD and models the feedback loop around implementation.

The lifecycle is:

- `draft`
- `in_progress`
- `done`

Two review types exist:

- `agent`
- `human`

Findings are not stored as separate blobs. They are stored as tasks with `reviewId` set and, optionally, a severity of `critical`, `major`, `minor`, or `info`.

Important behaviors:

- `depot review start` creates a review in `draft`
- findings can be added while the review stays in `draft`
- `depot review begin` validates the review draft and moves it to `in_progress`
- `depot review done` can close either an `in_progress` review or an empty `draft` review

The schema also includes a `userFeedback` field for human context, but the CLI does not yet expose a direct write path for it.

## Activity Log

The activity log stores structured events tied to the current project and, optionally, a workspace, PRD, or task.

Current event types are:

- `session_start`
- `prd_created`
- `prd_updated`
- `task_created`
- `task_updated`
- `task_started`
- `task_done`
- `task_blocked`
- `task_skipped`
- `prd_activated`
- `prd_ready`
- `prd_done`
- `prd_canceled`
- `prd_forked`
- `review_created`
- `review_updated`
- `review_started`
- `review_done`
- `note`
- `error`

Each entry stores a JSON payload. `depot log add` accepts strict JSON and a looser object-like syntax, which makes shell-escaped payloads easier to work with.

## Contexts

`depot context` renders live agent context for the current workspace.

The available modes are:

- `prd`
- `dev`
- `coder`
- `auditor`

Without a mode, `depot context` prints an index with a short usage line, dynamic status, and the exact command to load each detailed mode.

Modes:

- `prd` packages product-framing state and the embedded PRD-agent instructions
- `dev` packages orchestrator state for the active or targeted PRD
- `coder <prd-id> [--review <review-id>]` packages implementation work for a coder agent
- `auditor <prd-id>` packages completed work and prior review state for an auditor agent

These contexts are rendered views. They summarize and package state, but they do not themselves advance task or PRD lifecycle steps.

## Web Interface

`depot serve` exposes the same SQLite data through a small web UI.

The web layer currently provides:

- a PRD list view at `/`
- a PRD detail view at `/prds/:id`
- a small Hono API under `/api`

The web UI is read-only. It is a view over the same local database used by the CLI.

## Local-First Storage

By default, `depot` stores its database at `~/.depot/depot.db`.

Important runtime behaviors:

- the depot directory is created automatically when needed
- SQLite migrations are applied automatically on open
- the database path can be overridden with `DB_PATH`
- there is no remote service dependency in the current architecture

That keeps the workflow local, deterministic, terminal-friendly, and inspectable.
