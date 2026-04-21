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
- `review_started`
- `review_findings_recorded`
- `review_decision_recorded`
- `note`
- `handoff`
- `error`

---

## `depot log add`

Record a new activity entry.

### Usage

```bash
depot log add <event-type> [--task <task-id>] [--prd <prd-id>] [--payload <json>]
```

### Notes

- `--task` and `--prd` require full IDs and must belong to the current workspace.
- `--payload` defaults to `{}`.
- Payload must resolve to a JSON object.
- The CLI accepts both strict JSON and a looser object-like format (unquoted keys, single-quoted strings, bare values).

### Examples

```bash
depot log add note --payload '{"message":"Session started"}'
depot log add task_started --task <task-id> --payload '{"title":"Implement handoff"}'
depot log add handoff --payload '{"next":"Review the active PRD","context":"Handoff after task 3"}'
depot log add error --payload '{"message":"Workspace resolution failed"}'
```

---

## `depot log list`

List recent activity for the current project.

### Usage

```bash
depot log list [--last <count>]
```

`--last` defaults to 20. Must be a positive integer.

### Example

```bash
depot log list --last 10
```

Each output line includes the timestamp, event type, and a short summary derived from the stored payload.
