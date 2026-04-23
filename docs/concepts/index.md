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
- `ready`
- `in_progress`
- `done`
- `canceled`

Allowed transitions:

- `draft → ready`
- `ready → in_progress`
- `ready → draft` (fork: creates a new revision)
- `in_progress → done`
- `in_progress → canceled`

Key behaviors:

- `depot prd create` creates a draft PRD.
- `depot prd ready` marks a draft PRD as ready for execution.
- `depot prd activate` marks a ready PRD as in_progress.

### Versioning

Each PRD has a `rootId` that points to the original v1 (itself if it is v1). This allows querying an entire family with a single `WHERE root_id = ?`.

```
v1 : rootId = v1.id, parentId = null, revision = 1
v2 : rootId = v1.id, parentId = v1.id, revision = 2
v3 : rootId = v1.id, parentId = v2.id, revision = 3
```

When a `ready` PRD is forked, the original stays `ready` and a new `draft` revision is created with `parentId` pointing to it. The PRD listing shows only the latest revision of each family.

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
- an optional `review_id` linking the task to a review
- an optional `severity`: `critical`, `major`, `minor`, or `info` (relevant when `review_id` is set)

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

A review belongs to a PRD and tracks the audit and human sign-off loop for completed work.

Reviews are created by the auditor sub-agent or the orchestrator. The review lifecycle is:

- `draft` — created, findings being collected (protects against crash mid-audit)
- `in_progress` — tasks created, coder sub-agent working on them
- `done` — all review tasks completed

Two review types exist:

- `agent` — created by the auditor sub-agent after an autonomous code review
- `human` — created by the orchestrator after the human provides feedback

A review's findings are stored as tasks with `review_id` set and an optional `severity` (`critical`, `major`, `minor`, `info`). There are no separate JSON blobs for findings.

`user_feedback` (free text) is preserved on the review record for context.

Review commands:

- `depot review start <prd-id> --type <human|agent>` — create a review
- `depot review task add <review-id> --title ... --description ...` — add a finding task
- `depot review done <review-id>` — mark the review done
- `depot review list [prd-id]` — list reviews
- `depot review show <review-id>` — inspect a review

## Activity Log

The activity log stores structured events tied to the current project and optionally to a workspace, PRD, task, or review.

Current event types are:

- `session_start`
- `task_started`
- `task_done`
- `task_blocked`
- `task_skipped`
- `prd_ready`
- `prd_activated`
- `prd_done`
- `note`
- `error`

Each log entry includes a JSON payload. The CLI accepts standard JSON and also supports a looser object-like syntax for convenience.

## Contexts

`depot context` renders live agent context for the current workspace.

Current modes are:

- `prd` — product framing: PRD chain, Q&A, embedded PRD agent instructions. Accepts an optional PRD ID to continue an existing draft or fork a ready PRD.
- `dev` — orchestrator: launches the coder and auditor sub-agents, manages the review loop, requests human validation.
- `coder <prd-id> [--review <review-id>]` — implementation sub-agent: works the PRD tasks, or the tasks from a specific review when `--review` is given.
- `auditor <prd-id>` — audit sub-agent: reviews completed work and records findings as review tasks.

`depot context` without a mode prints an index with those four modes, a short dynamic status for each, and the exact command to render the detailed mode.

`depot context dev` also accepts an optional second positional argument to target a specific PRD by full ID or case-insensitive title substring.

## Local-first behavior

`depot` uses a local SQLite database at `~/.depot/depot.db` by default. The CLI applies pending Drizzle migrations automatically when the database is opened.

In the published npm package, the supported packaged migration layout is `dist/migrations/`.

This keeps the workflow:

- local
- deterministic
- terminal-friendly
- independent of a web service
