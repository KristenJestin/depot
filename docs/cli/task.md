# Task Commands

Tasks are the execution units inside a PRD.

## Status model

Current task statuses are:

- `pending`
- `in_progress`
- `blocked`
- `done`
- `skipped`

The current transition model is:

- `pending -> in_progress`
- `pending -> skipped`
- `in_progress -> done`
- `in_progress -> blocked`
- `blocked -> in_progress`
- `blocked -> skipped`

## `depot task add`

Add a new task to a PRD.

### Usage

```bash
depot task add --prd <prd-id> --title <title> --desc <text> --criteria <text> --effort <xs|s|m|l|xl> [--depends <task-id,task-id>]
```

### Rules

- `--desc` is required
- new task writes must use a compact `Intent:` / `Scope:` / `Non-goals:` description
- `--criteria` is required and must not be empty
- `--effort` must be one of `xs`, `s`, `m`, `l`, `xl`
- `--depends` accepts comma-separated full task IDs

### Example

```bash
depot task add --prd <prd-id> --title "Add handoff summary" --desc $'Intent:\nSummarize active workspace state for the next agent.\n\nScope:\n- Include the active PRD and recent workspace activity.\n\nNon-goals:\n- Do not redesign the handoff format.' --criteria "Includes active PRD\nIncludes recent activity" --effort m
```

## `depot task list`

List tasks for a PRD.

### Usage

```bash
depot task list [prd-id]
```

If no PRD ID is provided, `depot` looks for the active PRD in the current workspace.

### Output

Each line includes:

- the full task ID
- the task position
- the title
- the status
- the effort
- dependency IDs when present

## `depot task show`

Show detailed task fields.

### Usage

```bash
depot task show <task-id>
```

The command requires a full task ID.

Dev agents should treat `depot task show` as mandatory before starting a task and before resuming a task after an interruption or handoff, because `depot context dev` is only a summary view.

`depot task show` renders structured task descriptions section-by-section for new tasks that use `Intent:`, `Scope:`, and `Non-goals:`. Older freeform descriptions still render as a plain description block.

## `depot task start`

Start a pending task.

### Usage

```bash
depot task start <task-id>
```

This moves the task from `pending` to `in_progress` and sets `startedAt`.

## `depot task done`

Complete an in-progress task.

### Usage

```bash
depot task done <task-id>
```

Completion currently requires:

- the task to already be `in_progress`
- `startedAt` to be set
- `done_criteria` to be non-empty
- all dependency tasks to already be `done`

## `depot task block`

Block an in-progress task with an explicit reason.

### Usage

```bash
depot task block <task-id> <reason>
```

## `depot task skip`

Skip a pending or blocked task with an explicit reason.

### Usage

```bash
depot task skip <task-id> <reason>
```
