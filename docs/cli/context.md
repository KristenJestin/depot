# Context Command

`depot context` renders live agent context for the current workspace.

## `depot context`

Without a mode, the command prints an index for the three supported modes:

- `prd`
- `dev`
- `review`

Each section includes:

- a one-line usage summary
- a short dynamic status derived from the current workspace state
- the exact detail command

If the current directory does not resolve to a workspace, `depot context` silently creates a project and workspace for the current path before rendering the index.

`depot context` does not support `--json` output. Passing `--json` returns an unsupported error.

---

## `depot context prd`

Renders the product framing context for the current workspace.

The output includes:

- a mode header with project and workspace
- non-archived PRDs from newest to oldest (ID, title, status, revision)
- an actionable intro if a draft or committed PRD exists, prompting to run `depot prd show` before editing
- the embedded PRD agent instructions

---

## `depot context dev`

Renders the execution context for the active PRD.

### Usage

```bash
depot context dev [prd-target]
```

`prd-target` is an optional second positional argument. If provided, it is resolved first by exact PRD ID, then by case-insensitive substring match on the title. Ambiguous matches produce a clear error listing the candidates.

A targeted PRD must be in `committed` or `in_progress` status and must belong to the current workspace. If a committed PRD is targeted while another PRD is already active, the command fails.

### Output

- placeholder sections for Standards and Feedback (not yet modeled in depot)
- the active PRD with context and scope
- previous archived revisions in the PRD chain
- progress summary (done/total · in progress · blocked · pending · skipped)
- current task: ID, title, start time, description summary, done criteria, and an explicit `depot task show <task-id>` reminder
- blocked tasks with their reasons, or an explicit "no blocked tasks" message
- the last 10 activity entries for the current workspace
- next recommended task: ID, title, effort, description summary, done criteria, and an explicit `depot task show <task-id>` reminder
- the embedded Dev agent instructions

If multiple `in_progress` PRDs exist in the same workspace, the command fails with a clear conflict list.

`depot context dev` is a resume-oriented summary, not the complete task spec. Dev agents must run `depot task show <task-id>` before starting a task and again before resuming after an interruption or handoff.

---

## `depot context review`

Renders the review context for the active PRD.

The output includes:

- the active PRD with full context and scope
- active reviews (pending or in_progress): ID, status, mode, revision, user feedback, findings count, follow-up task count
- completed reviews count and summary
- done tasks ready for review: ID, position, title, completed timestamp, and done criteria
- the embedded Review agent instructions

If no done tasks exist, the section remains in the output with an explicit message.

If multiple `in_progress` PRDs exist, the command fails with a conflict list.

---

## Replacement note

`depot context` replaces the old `depot playbook` command surface.
