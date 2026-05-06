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
depot task add --prdId <prd-id> --title <title> (--desc <text> | --desc-file <path>) (--criteria <text> | --criteria-file <path>) --effort <xs|s|m|l|xl> [--depends <task-id,task-id>]
```

### Rules

- `--prdId` is required
- `--desc` or `--desc-file` is required
- `--criteria` or `--criteria-file` is required and must not be empty
- file inputs read UTF-8 text and are safer for structured content with lines that start with `-`
- inline and file variants for the same field are mutually exclusive
- `--effort` must be one of `xs`, `s`, `m`, `l`, `xl`
- `--depends` accepts comma-separated full task IDs
- each dependency is verified before the task is created

### Description storage

New task descriptions are always stored on the new-task path as `structured_v1`. There is
currently no `--desc-format` flag and no raw/freeform storage path for new tasks.

When the input already contains all three structured headings, depot parses and normalizes
them:

```text
Intent:
Why this task exists.

Scope:
- What should change.
- What should be verified.

Non-goals:
- What should not be pulled in.
```

The parser accepts `Intent:`, `Scope:`, and `Non-goals:` headings. `Scope` and
`Non-goals` are rendered as lists; leading `-` or `*` markers are normalized so `task show`
does not double the bullet marker.

Plain text is still accepted, but it is trimmed and stored with
`descriptionFormat: "structured_v1"`. Because it does not contain the full structured
shape, `depot task show` renders that content under a single `Description` section. Write
the structure explicitly when a task should display as Intent, Scope, and Non-goals in the
CLI and web UI.

For structured or markdown-like descriptions, prefer `--desc-file` so shell and CLI
argument parsers do not treat lines beginning with `-` as flags:

```bash
depot task add --prdId <prd-id> --title "Add context output" --desc-file task-desc.md --criteria-file task-criteria.md --effort m
```

Example `task-desc.md`:

```text
Intent:
Render a live workspace summary for agents.

Scope:
- Include the active PRD.
- Include the next available task.

Non-goals:
- Do not change the stored PRD schema.
```

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
