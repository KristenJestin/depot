# Concepts

`depot` is built around a small, explicit model for tracking agent work locally.

## Projects

A project is the top-level container for work.

Today, a project stores:

- a stable ID
- a name
- an optional description
- a status such as `active`, `paused`, or `done`

Projects are listed globally. The current CLI can create a project indirectly through `depot init` and list all projects with `depot project list`.

## Workspaces

A workspace binds a project to a canonical absolute path on disk.

This is how `depot` knows which project you mean when you run commands from a directory. Workspace resolution uses longest-prefix matching, so commands work from nested directories inside a registered workspace.

Important properties:

- a workspace belongs to one project
- workspace paths are unique
- a workspace can have an optional human label

If the current directory does not resolve to a workspace, most workspace-aware commands exit and ask you to run `depot init` first. `depot context` is the exception: it silently creates a project and workspace for the current path before rendering context.

## PRDs

A PRD belongs to a project and a workspace. It captures why work exists and what is in scope.

The current lifecycle is:

- `draft`
- `committed`
- `in_progress`
- `archived`

Key behaviors:

- `depot prd create` creates a draft PRD.
- `depot prd commit` freezes a draft PRD for execution.
- `depot prd activate` marks a committed PRD as the active PRD for its workspace.
- `depot prd amend` archives the current committed or active PRD and creates a new draft revision.

Only one PRD can be `in_progress` in a workspace at a time.

## Tasks

Tasks belong to a PRD and represent concrete execution units.

Each task includes:

- a title
- a required description
- required `done_criteria`
- an effort estimate: `xs`, `s`, `m`, `l`, or `xl`
- an ordered position within the PRD
- optional task dependencies

The current task lifecycle is:

- `pending`
- `in_progress`
- `blocked`
- `done`
- `skipped`

Important behaviors:

- a task must have non-empty `done_criteria`
- a task must be started before it can be completed
- a task can only be completed when all dependency tasks are already `done`
- blocking and skipping a task both require an explicit reason

## Activity Log

The activity log stores structured events tied to the current project and optionally to a workspace, PRD, or task.

Current event types are:

- `session_start`
- `task_started`
- `task_done`
- `task_blocked`
- `task_skipped`
- `prd_committed`
- `prd_activated`
- `prd_amended`
- `note`
- `handoff`
- `error`

Each log entry includes a JSON payload. The CLI accepts standard JSON and also supports a looser object-like syntax for convenience.

## Handoffs

`depot handoff` builds a plaintext summary for the current workspace.

When there is an active PRD, the handoff includes:

- the active PRD
- task progress
- the current in-progress task, if any
- blocked tasks, if any
- recent activity
- the next recommended pending task with satisfied dependencies, if any

When there is no active PRD, the handoff still shows recent activity and points the operator back to available PRDs.

## Contexts

`depot context` renders live agent context for the current workspace.

Current modes are:

- `prd`
- `dev`
- `review`

`depot context` without a mode prints an index with those three modes, a short dynamic status for each, and the exact command to render the detailed mode.

`depot context` replaces the older `playbook` command surface.

## Local-first behavior

`depot` currently uses a local SQLite database at `~/.depot/depot.db` by default. The CLI applies pending Drizzle migrations automatically when the database is opened.

In the published npm package, the supported packaged migration layout is `dist/migrations/`.

This keeps the workflow:

- local
- deterministic
- terminal-friendly
- independent of a web service
