# Task Commands

Tasks are the execution units inside a PRD.

## Status Model

Current task statuses are:

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

## `depot task add`

Add a new task to a PRD.

### Usage

```bash
depot task add --prdId <prd-id> --title <title> --desc <text> --criteria <text> --effort <xs|s|m|l|xl> [--depends <task-id,task-id>]
```

### Rules

- `--prdId` is required
- `--desc` is required
- `--criteria` is required and must not be empty
- `--effort` must be one of `xs`, `s`, `m`, `l`, `xl`
- `--depends` accepts comma-separated full task IDs
- each dependency is verified before the task is created

### Description format

New tasks are normalized toward the structured format:

```text
Intent:
Why this task exists.

Scope:
- What should change.
- What should be verified.

Non-goals:
- What should not be pulled in.
```

Even if you pass a plain description, depot currently stores it as `structured_v1`. Writing the structure explicitly keeps the task readable in both the CLI and the web UI.

## `depot task list`

List tasks for a PRD.

### Usage

```bash
depot task list [prd-id]
```

If no PRD ID is provided, depot looks for the active `in_progress` PRD in the current workspace.

Each line includes task ID, position, title, status, effort, and dependency IDs when present.

## `depot task show`

Show detailed task fields.

### Usage

```bash
depot task show <task-id>
```

Prints aligned fields for ID, Title, Status, Position, Effort, Format, Depends On, Blocked, Skipped, Created, Started, and Completed.

Structured descriptions are rendered section by section. Criteria are always shown as a list.

This is the detailed spec view an agent should read before starting or resuming work.

## `depot task start`

Start a pending task.

### Usage

```bash
depot task start <task-id>
```

Moves the task to `in_progress` and sets `startedAt`.

## `depot task done`

Complete an in-progress task.

### Usage

```bash
depot task done <task-id>
```

Completion requires:

- the task to already be `in_progress`
- `startedAt` to be set
- all dependency tasks to already be `done` or `skipped`

## `depot task block`

Block an in-progress task with an explicit reason.

### Usage

```bash
depot task block <task-id> <reason>
```

`reason` is required.

## `depot task skip`

Skip a pending or blocked task with an explicit reason.

### Usage

```bash
depot task skip <task-id> <reason>
```

`reason` is required.
