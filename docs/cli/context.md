# Context Command

`depot context` renders the live agent context for the current workspace.

## `depot context`

Without a mode, the command prints an index for the three supported modes in this order:

- `prd`
- `dev`
- `review`

Each section includes:

- a one-line usage summary
- a short dynamic status
- the exact detail command

If the current directory does not resolve to a workspace, `depot context` silently creates a project and workspace for the current path and continues.

## `depot context prd`

Renders the product framing context for the current workspace.

The output includes:

- a mode header with project and workspace
- non-archived PRDs from newest to oldest
- an actionable intro when a draft or committed PRD exists
- the embedded PRD instructions

## `depot context dev`

Renders the execution context for the active PRD.

The output includes:

- placeholder sections for Standards and Feedback until those features exist
- the active PRD
- archived revisions in the PRD chain
- progress summary
- current task summary, done criteria, and an explicit `depot task show <task-id>` reminder
- blocked tasks or an explicit absence message
- the last 10 activity entries for the current workspace
- the next recommended task summary plus an explicit `depot task show <task-id>` reminder
- the embedded Dev instructions

If multiple `in_progress` PRDs exist in the same workspace, the command fails with a clear conflict list.

`depot context dev` is a resume-oriented summary, not the complete task spec. Dev agents are expected to run `depot task show <task-id>` before starting a task and again before resuming after an interruption or handoff.

## `depot context review`

Renders the review context for the active PRD.

The output includes:

- the active PRD with full context and scope
- done tasks only, ordered by position
- each task's `done_criteria` and `completed_at`
- the embedded Review instructions

If no done tasks exist, the structure stays intact and the command prints an explicit message.

## Replacement note

`depot context` replaces the old `depot playbook` command surface.
