# PRD Commands

PRDs define why a body of work exists and what it covers. A PRD attaches to a workspace only when it is activated.

## Status Model

Current PRD statuses are:

- `draft`
- `ready`
- `in_progress`
- `done`
- `canceled`

Allowed transitions are:

- `draft -> ready`
- `draft -> canceled`
- `ready -> in_progress`
- `ready -> canceled`
- `in_progress -> done`
- `in_progress -> canceled`

Forking is not a direct status transition. It creates a new `draft` revision from a `ready` PRD.

## `depot prd create`

Create a new draft PRD in the current project's context.

### Usage

```bash
depot prd create --title <title> [--context <text>] [--scope <text>]
```

### Example

```bash
depot prd create --title "Core foundation" --context "Need persistent agent state" --scope "Project, PRD, task, and log flow"
```

## `depot prd list`

List the latest revision of each PRD family for the current project.

### Usage

```bash
depot prd list
```

Each line includes the PRD ID, title, status, and revision. Only the latest revision per family is shown.

## `depot prd show`

Show detailed PRD fields.

### Usage

```bash
depot prd show <prd-id>
```

Prints aligned key-value fields for ID, Title, Status, Revision, Root, Context, Scope, Parent, Created, Ready, and Activated.

## `depot prd update`

Update a draft PRD in place.

### Usage

```bash
depot prd update <prd-id> [--title <text>] [--context <text>] [--scope <text>]
```

Only `draft` PRDs can be updated in place. To revise a `ready` PRD, fork it first.

## `depot prd ready`

Mark a draft PRD as ready for execution.

### Usage

```bash
depot prd ready <prd-id>
```

Only `draft` PRDs can be marked ready.

## `depot prd activate`

Activate a ready PRD for execution.

### Usage

```bash
depot prd activate <prd-id>
```

Notes:

- only `ready` PRDs can be activated
- activation assigns the PRD to the current workspace
- a workspace can have only one `in_progress` PRD at a time

## `depot prd done`

Mark an `in_progress` PRD as done.

### Usage

```bash
depot prd done <prd-id>
```

Only `in_progress` PRDs can be marked done.

## `depot prd cancel`

Cancel a PRD.

### Usage

```bash
depot prd cancel <prd-id>
```

A PRD may be canceled while it is `draft`, `ready`, or `in_progress`.

## `depot prd fork`

Fork a ready PRD into a new draft revision.

### Usage

```bash
depot prd fork <prd-id>
```

The original revision stays `ready`. The fork gets:

- a new ID
- `revision + 1`
- `parentId` pointing to the original
- the same `rootId` as the rest of the family

Only `ready` PRDs can be forked.

## `depot prd load`

Create a PRD with tasks from a JSON document.

### Usage

```bash
depot prd load [--file <path>]
```

If `--file` is omitted, the command reads JSON from stdin.

### Expected JSON shape

```json
{
  "title": "Build routing",
  "context": "Need a navigable web UI",
  "scope": "List and detail routes",
  "ready": true,
  "tasks": [
    {
      "title": "Add router",
      "description": "Intent:\nAdd TanStack Router.\n\nScope:\n- Wire routes.\n\nNon-goals:\n- Do not add mutations.",
      "doneCriteria": "Router boots",
      "effort": "m",
      "dependsOn": []
    },
    {
      "title": "Add detail page",
      "description": "Intent:\nShow PRD detail.\n\nScope:\n- Add route.\n\nNon-goals:\n- Do not add editing.",
      "doneCriteria": "Detail page renders",
      "effort": "l",
      "dependsOn": [0]
    }
  ]
}
```

### Notes

- `tasks` must contain at least one task
- `dependsOn` uses zero-based indexes into earlier tasks in the same document
- only backward references are allowed
- the full batch is created transactionally
- when `ready` is true, the created PRD is immediately marked `ready`
