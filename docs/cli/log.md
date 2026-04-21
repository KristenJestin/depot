# Log Commands

The activity log records structured execution events for the current workspace.

## Event types

Current supported event types are:

- `session_start`
- `task_started`
- `task_done`
- `task_blocked`
- `task_skipped`
- `prd_committed`
- `prd_activated`
- `prd_amended`
- `note`
- `handoff`
- `error`

## `depot log add`

Record a new activity entry.

### Usage

```bash
depot log add <event-type> [--task <task-id>] [--prd <prd-id>] [--payload <json>]
```

### Notes

- `--task` and `--prd` accept full IDs or unambiguous prefixes
- `--payload` defaults to `{}`
- payload must resolve to a JSON object
- the CLI accepts both strict JSON and a looser object-like input format

### Examples

```bash
depot log add note --payload '{"message":"Session started"}'
depot log add task_started --task <task-id> --payload '{"title":"Implement handoff"}'
depot log add error --payload '{"message":"Workspace resolution failed"}'
```

## `depot log list`

List recent activity for the current project.

### Usage

```bash
depot log list [--last <count>]
```

### Example

```bash
depot log list --last 10
```

Each output line includes the timestamp, event type, and a short summary derived from the stored payload.
