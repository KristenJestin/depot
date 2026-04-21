# Concepts

`depot` is built around a small, explicit model for tracking agent work locally.

## Projects

A project is the top-level container for work.

A project stores:

- a stable ULID
- a name
- an optional description
- a status: `active`, `paused`, or `done`

Projects are listed globally with `depot project list`. The current CLI can create a project indirectly through `depot init` or manage them directly with `depot project show`, `depot project update`, and `depot project archive`.

## Workspaces

A workspace binds a project to a canonical absolute path on disk.

This is how `depot` knows which project you mean when you run commands from a directory. Workspace resolution uses longest-prefix matching on canonical absolute paths, so commands work from nested directories inside a registered workspace.

Important properties:

- a workspace belongs to one project
- workspace paths are unique across the database
- a workspace can have an optional human label

If the current directory does not resolve to a workspace, most workspace-aware commands exit and ask you to run `depot init` first. `depot context` is the exception: it silently creates a project and workspace for the current path before rendering context.

Workspaces can be managed with `depot workspace list`, `depot workspace show`, `depot workspace rename`, and `depot workspace remove`.

## PRDs

A PRD belongs to a project and a workspace. It captures why work exists and what is in scope.

The lifecycle is:

- `draft`
- `committed`
- `in_progress`
- `archived`

Allowed transitions:

- `draft → committed`
- `committed → in_progress`
- `committed → archived`
- `in_progress → archived`

Key behaviors:

- `depot prd create` creates a draft PRD.
- `depot prd commit` freezes a draft PRD for execution.
- `depot prd activate` marks a committed PRD as the active PRD for its workspace.
- `depot prd amend` archives the current committed or active PRD and creates a new draft revision with an incremented revision number.
- `depot prd archive` explicitly archives a committed or active PRD.

Only one PRD can be `in_progress` in a workspace at a time.

## Tasks

Tasks belong to a PRD and represent concrete execution units.

Each task includes:

- a title
- a description (required, must use `structured_v1` format for new tasks)
- required `done_criteria`
- an effort estimate: `xs`, `s`, `m`, `l`, or `xl`
- an ordered position within the PRD
- optional task dependencies (comma-separated task IDs)

The `structured_v1` description format requires three sections:

- `Intent:` — why this task exists
- `Scope:` — what the dev agent should change or verify
- `Non-goals:` — what should not be pulled into this task

Older legacy freeform task descriptions remain readable without a required retrofit.

The task lifecycle is:

- `pending`
- `in_progress`
- `blocked`
- `done`
- `skipped`

Allowed transitions:

- `pending → in_progress`
- `pending → skipped`
- `in_progress → done`
- `in_progress → blocked`
- `blocked → in_progress`
- `blocked → skipped`

Important behaviors:

- a task must have non-empty `done_criteria`
- a task must be started before it can be completed
- a task can only be completed when all dependency tasks are already `done`
- blocking and skipping a task both require an explicit reason

## Reviews

A review belongs to a PRD and tracks the human sign-off loop for completed work.

Reviews are created by the review agent and decided by the human. The review lifecycle is:

- `pending` — created, not yet activated
- `in_progress` — agent is working on it
- `completed` — human has recorded a decision

Two review modes exist:

- `autonomous` — the agent reviews all done tasks independently using the PRD context and done criteria
- `assisted` — the user provides free-text feedback; the agent reformulates it, asks clarifying questions, then produces structured findings

A review captures:

- structured findings: `[{ title, severity, description }]`
- clarifying questions (assisted mode): `[{ question, context }]`
- suggested follow-up tasks: `[{ title, description, rationale }]`
- a human decision: `approved`, `changes_requested`, or `rejected`
- an optional decision note

Only the human can close a review with `depot review decide`. The agent must never call this command autonomously.

## Activity Log

The activity log stores structured events tied to the current project and optionally to a workspace, PRD, task, or review.

Current event types are:

- `session_start`
- `task_started`
- `task_done`
- `task_blocked`
- `task_skipped`
- `prd_committed`
- `prd_activated`
- `prd_amended`
- `review_started`
- `review_findings_recorded`
- `review_decision_recorded`
- `note`
- `handoff`
- `error`

Each log entry includes a JSON payload. The CLI accepts standard JSON and also supports a looser object-like syntax for convenience.

## Handoffs

`depot handoff` builds a plaintext summary for the current workspace.

When there is an active PRD, the handoff includes:

- the active PRD title and revision
- task progress counts
- the current in-progress task, if any
- blocked tasks, if any
- the 10 most recent activity entries
- the next recommended pending task with all dependencies satisfied, if any

When there is no active PRD, the handoff still shows recent activity and points the operator back to available PRDs.

## Contexts

`depot context` renders live agent context for the current workspace.

Current modes are:

- `prd` — product framing: non-archived PRD chain, actionable PRD prompt, embedded PRD agent instructions
- `dev` — execution context: active PRD, previous revisions, task progress, current task, blocked tasks, recent activity, next recommended task, embedded dev agent instructions
- `review` — review context: active PRD, active and completed reviews, done tasks ready for review, embedded review agent instructions

`depot context` without a mode prints an index with those three modes, a short dynamic status for each, and the exact command to render the detailed mode.

`depot context dev` also accepts an optional second positional argument to target a specific PRD by full ID or case-insensitive title substring.

## Local-first behavior

`depot` uses a local SQLite database at `~/.depot/depot.db` by default. The CLI applies pending Drizzle migrations automatically when the database is opened.

In the published npm package, the supported packaged migration layout is `dist/migrations/`.

This keeps the workflow:

- local
- deterministic
- terminal-friendly
- independent of a web service
