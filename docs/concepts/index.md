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

This is how `depot` knows which project you mean when you run workspace-aware commands from a directory. Resolution uses longest-prefix matching on canonical paths, so a command launched from any nested subdirectory still resolves to the correct workspace. If the path is inside a git worktree and nothing matches directly, `depot` falls back to the main worktree path before giving up.

Important properties:

- a workspace belongs to exactly one project
- workspace paths are unique across the database (stored in the `workspaces` table)
- a workspace may have an optional human label
- path normalization uses forward slashes, and lowercases paths on Windows
- workspaces are flat: `depot` does not mark one as "primary" or distinguish a worktree from its main checkout

If the current directory does not resolve to a workspace, most workspace-aware commands exit and ask you to run `depot init` (to create a new project) or `depot workspace add` (to attach the folder to an existing project).

`depot context` is the main exception: it uses auto-create mode and silently creates a project plus workspace for the current path before rendering context.

The CLI exposes `depot workspace list`, `depot workspace show`, `depot workspace rename`, `depot workspace remove`, and `depot workspace add` (alias `link`) to attach an existing folder to an existing project.

## Project Repos

A project repo is an optional registry entry that names a git repo belonging to a project, so `depot` can target it for git-aware operations.

Project repos live in the `project_repo` table. Each row stores:

- the project it belongs to
- a `name` unique within the project (for example `front`, `api`, `common`)
- a `path` (absolute, or relative to the workspace)
- a base branch

When the registry is empty for a project, `depot` falls back to a single **implicit repo** rooted at the workspace path. There is no auto-discovery of sibling repositories: anything beyond the implicit case must be registered explicitly with `depot project repo add`.

### Two ways to map a project to disk

Both modes use the same model — only the contents of `project_repo` change.

**Mono-repo (classic).** The project folder _is_ a git repo. One workspace points at it, the project has no `project_repo` rows, and the implicit repo covers all git operations.

```
~/code/my-app          ← workspace, also the git repo (implicit project_repo)
  ├── .git
  ├── src/
  └── package.json
```

**Multi-repo (shell root).** The workspace folder is a "shell" that holds agent configuration (`CLAUDE.md`, `.claude/`, scripts) and may have its own `.git`. The actual code lives in sibling sub-folders, each its own git repo with its own remote, registered as `project_repo` rows with paths relative to the workspace.

```
~/code/platform        ← workspace (shell root; may carry its own .git for config)
  ├── CLAUDE.md
  ├── api/             ← project_repo "api"     (path "api")
  ├── front/           ← project_repo "front"   (path "front")
  └── common/          ← project_repo "common"  (path "common")
```

### Things `depot` does not do

`depot` tracks where the code lives so it can route git-aware actions. It does not set up that code. In particular:

- `depot` never creates or deletes a folder on disk. `depot init` and `depot workspace add` register an existing path; they do not materialise one.
- `depot` does not create or remove git worktrees, copies of the project, branches, or development environments. That belongs to your shell tooling, IDE, or an external skill.
- `depot` does not enforce a branch-naming convention or pick a branch for you.

When a worktree or sibling clone is created externally, attach it with `depot workspace add --project <id|name>` so `depot` can resolve it.

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

### One active PRD per workspace

`depot prd activate` enforces a hard rule: a workspace can have **at most one PRD in status `in_progress` at any time**. Attempting to activate a second PRD against the same workspace fails with `WorkspaceAlreadyHasActivePrdError`, naming the PRD that already holds the slot.

This is what makes the workspace the unit of agent focus: the activated PRD plus its workspace path are how `depot` knows what the current session is supposed to be working on. To work on a second PRD in parallel, attach a different folder (typically a git worktree) as a separate workspace with `depot workspace add`, and activate the second PRD from there.

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

New task descriptions are normalized to the `structured_v1` storage path:

- `Intent:` why this task exists now
- `Scope:` what should change or be verified
- `Non-goals:` what should not be pulled into the task

There is currently no `--desc-format` flag for choosing another format when creating or
updating tasks. Plain text input is still accepted and trimmed, but new task rows store
`descriptionFormat` as `structured_v1`. If the content does not include the full
`Intent`, `Scope`, and `Non-goals` shape, `depot task show` renders it under a single
`Description` section. Older freeform descriptions remain readable.

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
- the database path can be overridden with `DEPOT_DB_PATH` (the legacy `DB_PATH` is still
  honoured with a deprecation warning)
- there is no remote service dependency in the current architecture

That keeps the workflow local, deterministic, terminal-friendly, and inspectable.
