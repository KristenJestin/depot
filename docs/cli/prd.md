# PRD Commands

PRDs define the intent and scope of work for a workspace.

## Status model

Current PRD statuses are:

- `draft` — in construction via questions agent. Editable freely.
- `ready` — all questions answered. PRD complete.
- `in_progress` — execution in progress (dev + automatic review included).
- `done` — validated by the human. Terminal.
- `canceled` — canceled. Terminal.

Allowed transitions:

- `draft → ready`
- `ready → in_progress`
- `ready → draft` (fork v2, via `depot prd fork`)
- `in_progress → done`

---

## `depot prd create`

Create a new draft PRD in the current workspace.

### Usage

```bash
depot prd create --title <title> [--context <text>] [--scope <text>]
```

### Example

```bash
depot prd create --title "Core foundation" --context "Need persistent agent state" --scope "Project, PRD, task, and log flow"
```

---

## `depot prd list`

List the latest revision of each PRD family for the current project.

### Usage

```bash
depot prd list
```

### Output

Each line includes the PRD ID, title, status, and revision number. Only the latest revision per family is shown.

---

## `depot prd show`

Show detailed PRD fields.

### Usage

```bash
depot prd show <prd-id>
```

### Output

Prints aligned key-value fields: ID, Title, Status, Revision, Root, Context, Scope, Parent, Created, Ready, Activated.

---

## `depot prd ready`

Mark a draft PRD as ready for execution.

### Usage

```bash
depot prd ready <prd-id>
```

Only PRDs in `draft` status can be marked ready.

---

## `depot prd activate`

Mark a ready PRD as active for execution.

### Usage

```bash
depot prd activate <prd-id>
```

Only PRDs in `ready` status can be activated. A workspace can only have one `in_progress` PRD at a time.

---

## `depot prd done`

Mark an in_progress PRD as done (after human validation).

### Usage

```bash
depot prd done <prd-id>
```

Only PRDs in `in_progress` status can be marked done.

---

## `depot prd fork`

Fork a ready PRD into a new draft revision.

The original PRD stays in `ready` status (not canceled). The fork creates a new PRD with `revision + 1`, `parentId` pointing to the original, and a shared `rootId` for family queries.

### Usage

```bash
depot prd fork <prd-id>
```

Only PRDs in `ready` status can be forked.

---

## `depot prd cancel`

Cancel a draft, ready, or in_progress PRD.

### Usage

```bash
depot prd cancel <prd-id>
```
