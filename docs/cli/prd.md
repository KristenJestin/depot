# PRD Commands

PRDs define the intent and scope of work for a workspace.

## Status model

Current PRD statuses are:

- `draft`
- `committed`
- `in_progress`
- `archived`

Allowed transitions:

- `draft → committed`
- `committed → in_progress`
- `committed → archived`
- `in_progress → archived`

In practice, `depot prd amend` archives the current PRD and creates a new draft revision at `revision + 1`.

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

List PRDs for the current project.

### Usage

```bash
depot prd list
```

### Output

Each line includes the PRD ID, title, status, and revision number.

---

## `depot prd show`

Show detailed PRD fields.

### Usage

```bash
depot prd show <prd-id>
```

### Output

Prints aligned key-value fields: ID, Title, Status, Revision, Context, Scope, Parent, Created, Committed, Activated.

---

## `depot prd commit`

Commit a draft PRD, freezing it for execution.

### Usage

```bash
depot prd commit <prd-id>
```

Only PRDs in `draft` status can be committed.

---

## `depot prd activate`

Mark a committed PRD as active for execution.

### Usage

```bash
depot prd activate <prd-id>
```

Only PRDs in `committed` status can be activated. A workspace can only have one `in_progress` PRD at a time. The command errors if another PRD is already active.

---

## `depot prd amend`

Create a new PRD revision from a committed or active PRD.

### What it does

- archives the original PRD
- creates a new PRD with `revision + 1`
- stores the original PRD ID in `parentId`
- starts the new revision in `draft`

### Usage

```bash
depot prd amend <prd-id> [--title <title>] [--context <text>] [--scope <text>]
```

Fields not provided default to their current values from the original PRD.

### Example

```bash
depot prd amend <prd-id> --scope "Expand the initial CLI scope to cover structured logging"
```

---

## `depot prd archive`

Explicitly archive a committed or active PRD.

### Usage

```bash
depot prd archive <prd-id>
```

PRDs in `draft` status cannot be archived directly. Use `prd amend` or `prd commit` first.
