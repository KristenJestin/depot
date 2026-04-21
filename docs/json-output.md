# JSON Output Contract (v1)

Pass `--json` before any subcommand to switch depot to machine-readable mode:

```
depot --json <command> [args]
```

All output goes to **stdout**. Nothing else is written to stdout when `--json` is active.
Debug output and internal logs continue to go to **stderr**.

---

## Success envelope

```json
{ "kind": "success", "payload": { ... } }
```

- Single-item results use `payload.item`.
- List results use `payload.items` (may be an empty array).
- Mutations return the final persisted state in `payload.item`.

## Error envelope

```json
{ "kind": "error", "error": { "code": "<code>", "message": "<human text>" } }
```

Exit code is **1** on all errors. Known error codes:

| Code | Meaning |
|---|---|
| `not_found` | The requested resource does not exist |
| `no_workspace` | No workspace registered for the current path |
| `no_active_prd` | No in-progress PRD in the current workspace |
| `invalid_description` | Task description does not use `structured_v1` format |
| `validation_error` | Argument validation failed |
| `validation` | Inline validation failure in a command (e.g. assisted review without feedback) |
| `no_changes` | No update fields provided to `project update` |
| `already_done` | Project is already archived |
| `linked_data` | Workspace cannot be removed because it has linked PRDs (use `--force`) |
| `unsupported` | The command does not support `--json` in v1 |

---

## Supported commands

### `init`

```json
{ "kind": "success", "payload": { "project": { ... }, "workspace": { ... } } }
```

### `project list`

```json
{ "kind": "success", "payload": { "items": [ { "id", "name", "status", "description", "createdAt", "updatedAt" } ] } }
```

### `project show`

```json
{ "kind": "success", "payload": { "item": { "id", "name", "status", "description", "createdAt", "updatedAt" } } }
```

### `project update` / `project archive`

```json
{ "kind": "success", "payload": { "item": { ... } } }
```

Returns the final project state after the mutation.

### `workspace list`

```json
{ "kind": "success", "payload": { "items": [ { "id", "projectId", "path", "label", "createdAt", "updatedAt" } ] } }
```

### `workspace show`

```json
{ "kind": "success", "payload": { "item": { ... }, "project": { ... } } }
```

### `workspace rename`

```json
{ "kind": "success", "payload": { "item": { ... } } }
```

### `workspace remove`

```json
{ "kind": "success", "payload": { "removed": "<workspace-id>" } }
```

### `prd create`

```json
{ "kind": "success", "payload": { "item": { "id", "title", "status", "revision", "context", "scope", "parentId", "projectId", "workspaceId", "createdAt", "committedAt", "activatedAt" } } }
```

### `prd show`

```json
{ "kind": "success", "payload": { "item": { "id", "title", "status", "revision", "context", "scope", "parentId", "createdAt", "committedAt", "activatedAt" } } }
```

### `prd list`

```json
{ "kind": "success", "payload": { "items": [ { ... } ] } }
```

### `prd commit` / `prd activate` / `prd amend` / `prd archive`

```json
{ "kind": "success", "payload": { "item": { ... } } }
```

Returns the final PRD state after the mutation.

### `task add`

```json
{ "kind": "success", "payload": { "item": { "id", "title", "status", "position", "effort", "dependsOn": [], "description", "descriptionFormat", "doneCriteria", "prdId", "createdAt", "startedAt", "completedAt", "blockedReason", "skipReason" } } }
```

`dependsOn` is a parsed string array, not a raw JSON string.

### `task list`

```json
{ "kind": "success", "payload": { "items": [ { ... } ] } }
```

### `task show`

```json
{ "kind": "success", "payload": { "item": { ... } } }
```

### `task start` / `task done` / `task block` / `task skip`

```json
{ "kind": "success", "payload": { "item": { ... } } }
```

Returns the final task state after the mutation.

### `log add`

```json
{ "kind": "success", "payload": { "item": { "id", "eventType", "payload": { ... }, "projectId", "workspaceId", "prdId", "taskId", "reviewId", "createdAt" } } }
```

`payload` is a parsed object.

### `log list`

```json
{ "kind": "success", "payload": { "items": [ { ..., "payload": { ... } } ] } }
```

### `handoff`

```json
{
  "kind": "success",
  "payload": {
    "item": {
      "project": { "id", "name" },
      "workspace": { "id", "path", "label" },
      "generatedAt": "<ISO 8601>",
      "activePrd": { "id", "title", "revision", "context" } | null,
      "taskProgress": { "total", "done", "inProgress", "blocked", "pending" } | null,
      "currentTask": { "id", "title", "effort", "doneCriteria": [], "startedAt", "blockedReason" } | null,
      "blockedTasks": [ { "id", "title", "blockedReason" } ],
      "nextRecommendedTask": { ... } | null,
      "recentActivity": [ { "createdAt", "eventType", "payload": { ... } } ]
    }
  }
}
```

### `review start`

```json
{ "kind": "success", "payload": { "item": { "id", "prdId", "prdRevision", "status", "mode", "userFeedback", "findings", "questions", "followupTasks", "decision", "decisionNote", "createdAt", "completedAt" } } }
```

### `review activate`

```json
{ "kind": "success", "payload": { "item": { ... } } }
```

### `review show`

```json
{ "kind": "success", "payload": { "item": { ... } } }
```

### `review list`

```json
{ "kind": "success", "payload": { "items": [ { ... } ] } }
```

### `review findings`

```json
{ "kind": "success", "payload": { "item": { ... } } }
```

Returns the updated review state.

### `review decide`

```json
{ "kind": "success", "payload": { "item": { ... } } }
```

Returns the completed review with the recorded decision.

---

## Excluded from v1

- `context` — returns `{ "kind": "error", "error": { "code": "unsupported", ... } }`
- `install` — not part of the machine-consumer surface
- Streaming output
- Published JSON Schema files
- A versioned stability contract independent of depot releases
