# PRD Commands

PRDs define the intent and scope of work for a workspace.

## Status model

Current PRD statuses are:

- `draft`
- `committed`
- `in_progress`
- `archived`

The current transition model is:

- `draft -> committed`
- `committed -> in_progress`
- `committed -> archived`
- `in_progress -> archived`

In practice, `depot prd amend` archives the current PRD and creates a new draft revision.

## `depot prd create`

Create a new draft PRD in the current workspace.

### Usage

```bash
depot prd create --title <title> [--context <text>] [--scope <text>]
```

### Example

```bash
depot prd create --title "Core foundation" --context "Need persistent agent state" --scope "Project, PRD, task, log, and handoff flow"
```

## `depot prd list`

List PRDs for the current project.

### Usage

```bash
depot prd list
```

### Output

Each line includes:

- a shortened PRD ID
- the title
- the status
- the revision number

## `depot prd show`

Show detailed PRD fields.

### Usage

```bash
depot prd show <prd-id>
```

The command accepts full IDs or unambiguous prefixes.

## `depot prd commit`

Commit a draft PRD.

### Usage

```bash
depot prd commit <prd-id>
```

Only PRDs in `draft` status can be committed.

## `depot prd activate`

Mark a committed PRD as active for execution.

### Usage

```bash
depot prd activate <prd-id>
```

Only PRDs in `committed` status can be activated. A workspace can only have one active PRD at a time.

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

### Example

```bash
depot prd amend <prd-id> --scope "Expand the initial CLI scope to cover structured logging"
```
