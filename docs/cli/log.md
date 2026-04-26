# Log Commands

The activity log records structured execution events for the current project and, optionally, the current workspace.

## Event Types

Supported event types are:

- `session_start`
- `task_started`
- `task_done`
- `task_blocked`
- `task_skipped`
- `prd_activated`
- `prd_ready`
- `prd_done`
- `prd_canceled`
- `prd_forked`
- `note`
- `error`

## `depot log add`

Record a new activity entry.

### Usage

```bash
depot log add <event-type> [--task <task-id>] [--prd <prd-id>] [--payload <json>]
```

### Notes

- `--task` and `--prd` require full IDs when provided
- they are validated against the current project and workspace context
- `--payload` defaults to `{}`
- payload must resolve to a JSON object
- the CLI accepts strict JSON and a looser object-like syntax

### Examples

```bash
depot log add note --payload '{"message":"Session started"}'
depot log add task_started --task <task-id> --payload '{"title":"Implement CLI command"}'
depot log add error --payload '{"message":"Workspace resolution failed"}'
```

## `depot log list`

List recent activity.

### Usage

```bash
depot log list [--last <count>] [--workspace]
```

### Notes

- `--last` defaults to `20`
- `--workspace` restricts results to the current workspace
- without `--workspace`, the command shows activity for the whole current project

Each output line includes the timestamp, event type, and a short summary derived from the stored payload.
