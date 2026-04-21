# Task Commands

Tasks are the execution units inside a PRD.

## Status model

Current task statuses are:

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

---

## `depot task add`

Add a new task to a PRD.

### Usage

```bash
depot task add --prd <prd-id> --title <title> --desc <text> --criteria <text> --effort <xs|s|m|l|xl> [--depends <task-id,task-id>]
```

### Rules

- `--desc` is required and must use the `structured_v1` format with `Intent:`, `Scope:`, and `Non-goals:` sections.
- `--criteria` is required and must not be empty.
- `--effort` must be one of `xs`, `s`, `m`, `l`, `xl`.
- `--depends` accepts comma-separated full task IDs. Each dependency is verified to exist before the task is created.

### Example

```bash
depot task add \
  --prd <prd-id> \
  --title "Add handoff summary" \
  --desc $'Intent:\nSummarize active workspace state for the next agent.\n\nScope:\n- Include the active PRD and recent workspace activity.\n\nNon-goals:\n- Do not redesign the handoff format.' \
  --criteria "Includes active PRD\nIncludes recent activity" \
  --effort m
```

---

## `depot task list`

List tasks for a PRD.

### Usage

```bash
depot task list [prd-id]
```

If no PRD ID is provided, `depot` looks for the active (`in_progress`) PRD in the current workspace and errors if none is found.

### Output

Each line includes the task ID, position, title, status, effort, and dependency IDs if any.

---

## `depot task show`

Show detailed task fields.

### Usage

```bash
depot task show <task-id>
```

### Output

Prints aligned key-value fields: ID, Title, Status, Position, Effort, Format, Depends On, Blocked reason, Skip reason, Created, Started, Completed.

Structured descriptions (`structured_v1`) are rendered section-by-section with `Intent:`, `Scope:`, and `Non-goals:` labels. Legacy freeform descriptions render as a plain `Description:` block. Done criteria always renders as a `Criteria:` list.

Dev agents must run `depot task show` before starting a task and before resuming after an interruption or handoff. `depot context dev` is only a summary view.

---

## `depot task start`

Start a pending task.

### Usage

```bash
depot task start <task-id>
```

Moves the task from `pending` to `in_progress` and sets `startedAt`.

---

## `depot task done`

Complete an in-progress task.

### Usage

```bash
depot task done <task-id>
```

Completion requires:

- the task to already be `in_progress`
- `startedAt` to be set
- `done_criteria` to be non-empty
- all dependency tasks to already be `done`

---

## `depot task block`

Block an in-progress task with an explicit reason.

### Usage

```bash
depot task block <task-id> <reason>
```

`reason` is a required positional argument.

---

## `depot task skip`

Skip a pending or blocked task with an explicit reason.

### Usage

```bash
depot task skip <task-id> <reason>
```

`reason` is a required positional argument.
