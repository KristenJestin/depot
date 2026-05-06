# JSON Output Contract

Pass `--json` before the command to switch supported commands to machine-readable output:

```bash
depot --json <command> [args]
```

All depot-owned JSON envelopes are written to stdout. Debug output stays on stderr.

## Success Envelope

```json
{ "kind": "success", "payload": { ... } }
```

Payload conventions:

- single-item reads and mutations usually use `payload.item`
- list commands use `payload.items`
- a few compound operations return named fields such as `project`, `workspace`, `prd`, or `tasks`

The covered mutation standard is:

- `payload.item`: `task add`, `task done`, `task skip`, `prd create`, `review task add`
- `payload.items`: `prd list`, `review list`
- named compound payloads: `prd load` returns `payload.prd` and `payload.tasks`

## Error Envelope

```json
{ "kind": "error", "error": { "code": "<code>", "message": "<human text>" } }
```

All explicit `output.error(...)` paths exit with code `1`.

Common command-level error codes include:

| Code                 | Meaning                                                         |
| -------------------- | --------------------------------------------------------------- |
| `validation_error`   | argument validation failed                                      |
| `not_found`          | requested entity does not exist                                 |
| `no_workspace`       | no workspace matched the current path                           |
| `no_active_prd`      | no active PRD is available for the requested operation          |
| `no_changes`         | no update fields were supplied                                  |
| `conflicting_input`  | mutually exclusive inline/file flags were supplied              |
| `already_done`       | archive or done action was requested for something already done |
| `linked_data`        | workspace removal is blocked by linked PRDs                     |
| `invalid_payload`    | log payload could not be parsed                                 |
| `file_read_error`    | a command could not read the requested input file               |
| `invalid_depends_on` | a `prd load` document used invalid task index references        |
| `unsupported`        | the command does not support JSON output                        |
| `render_error`       | context rendering failed                                        |
| `install_error`      | install target resolution failed                                |
| `db_error`           | database initialization or lookup failed                        |

## Field Serialization Notes

- `Date` values are serialized as ISO strings
- `task.dependsOn` is returned as a parsed JSON array, not a raw string
- `activity.payload` is returned as a parsed object, not a raw string

## Command Shapes

### Init

`depot --json init ...`

```json
{ "kind": "success", "payload": { "project": { ... }, "workspace": { ... } } }
```

### Project Commands

`project list`

```json
{ "kind": "success", "payload": { "items": [ ... ] } }
```

`project show`, `project update`, `project archive`

```json
{ "kind": "success", "payload": { "item": { ... } } }
```

### Workspace Commands

`workspace list`

```json
{ "kind": "success", "payload": { "items": [ ... ] } }
```

`workspace show`

```json
{ "kind": "success", "payload": { "item": { ... }, "project": { ... } } }
```

`workspace rename`

```json
{ "kind": "success", "payload": { "item": { ... } } }
```

`workspace remove`

```json
{ "kind": "success", "payload": { "removed": "<workspace-id>" } }
```

### PRD Commands

`prd create`, `prd show`, `prd activate`, `prd ready`, `prd done`, `prd cancel`, `prd fork`

```json
{ "kind": "success", "payload": { "item": { ... } } }
```

`prd list`

```json
{ "kind": "success", "payload": { "items": [ ... ] } }
```

`prd load`

```json
{ "kind": "success", "payload": { "prd": { ... }, "tasks": [ ... ] } }
```

### Task Commands

`task add`, `task show`, `task start`, `task done`, `task block`, `task skip`

```json
{ "kind": "success", "payload": { "item": { ... } } }
```

`task list`

```json
{ "kind": "success", "payload": { "items": [ ... ] } }
```

Representative task shape:

```json
{
  "kind": "success",
  "payload": {
    "item": {
      "id": "01...",
      "prdId": "01...",
      "title": "Implement context command",
      "status": "pending",
      "position": 1,
      "effort": "m",
      "dependsOn": [],
      "description": "Intent:\n...",
      "descriptionFormat": "structured_v1",
      "doneCriteria": "...",
      "blockedReason": null,
      "skipReason": null,
      "createdAt": "2026-04-26T10:00:00.000Z"
    }
  }
}
```

### Review Commands

`review start`, `review task add`, `review done`

```json
{ "kind": "success", "payload": { "item": { ... } } }
```

`review list`

```json
{ "kind": "success", "payload": { "items": [ ... ] } }
```

`review show`

```json
{ "kind": "success", "payload": { "item": { ... }, "tasks": [ ... ] } }
```

### Log Commands

`log add`

```json
{ "kind": "success", "payload": { "item": { ... } } }
```

`log list`

```json
{ "kind": "success", "payload": { "items": [ ... ] } }
```

Representative log item shape:

```json
{
  "kind": "success",
  "payload": {
    "item": {
      "id": "01...",
      "eventType": "note",
      "projectId": "01...",
      "workspaceId": "01...",
      "prdId": null,
      "taskId": null,
      "payload": {
        "message": "Started implementation"
      },
      "createdAt": "2026-04-26T10:00:00.000Z"
    }
  }
}
```

### Install Command

`install`

```json
{
  "kind": "success",
  "payload": {
    "items": [
      { "target": "opencode", "mode": "prd", "kind": "command", "filePath": "..." },
      { "target": "opencode", "mode": "dev", "kind": "command", "filePath": "..." },
      { "target": "codex", "mode": "prd", "kind": "skill", "filePath": ".../SKILL.md" },
      { "target": "codex", "mode": "prd", "kind": "skill", "filePath": ".../agents/openai.yaml" }
    ]
  }
}
```

## Not Included

- `context` explicitly rejects JSON mode with `unsupported`
- `serve` is not part of the JSON contract
- parser-level help output or argument errors that occur before depot's command handler runs may not be wrapped in the depot envelope
- there are no published JSON Schema files for these payloads yet
