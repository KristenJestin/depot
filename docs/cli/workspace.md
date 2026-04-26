# Workspace Commands

Workspace commands inspect and manage the workspaces registered in the local database.

## `depot workspace list`

List all registered workspaces.

### Usage

```bash
depot workspace list
```

Each line includes the workspace ID, canonical path, optional label, and linked project ID.

If no workspaces exist, the CLI tells you to run `depot init` first.

## `depot workspace show`

Show full details for a workspace.

### Usage

```bash
depot workspace show <workspace-id>
```

Prints aligned key-value fields for ID, Path, Label, Project, Created, and Updated.

## `depot workspace rename`

Set or update the human label for a workspace.

### Usage

```bash
depot workspace rename <workspace-id> --label <label>
```

`--label` is required.

## `depot workspace remove`

Remove a workspace from the database.

### Usage

```bash
depot workspace remove <workspace-id> [--force]
```

### Notes

- without `--force`, removal is blocked if the workspace has linked PRDs
- with `--force`, depot removes the workspace and deletes PRDs, tasks, and activity records linked through that workspace
- workspace-scoped activity rows are also removed

Use `--force` with care. The operation is intentionally destructive.
