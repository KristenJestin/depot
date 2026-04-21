# Workspace Commands

Workspace commands inspect and manage the workspaces registered in the local database.

## `depot workspace list`

List all registered workspaces.

### Usage

```bash
depot workspace list
```

### Output

Each line includes the workspace ID, canonical path, optional label, and the linked project ID.

If no workspaces exist, the CLI tells you to run `depot init` first.

---

## `depot workspace show`

Show full details for a workspace.

### Usage

```bash
depot workspace show <workspace-id>
```

### Output

Prints aligned key-value fields: ID, Path, Label, Project (name and ID), Created, Updated.

---

## `depot workspace rename`

Set or update the human label for a workspace.

### Usage

```bash
depot workspace rename <workspace-id> --label <label>
```

`--label` is required.

---

## `depot workspace remove`

Remove a workspace from the database.

### Usage

```bash
depot workspace remove <workspace-id> [--force]
```

### Notes

- Without `--force`, the command is blocked if the workspace has linked PRDs.
- With `--force`, the workspace is removed along with all linked PRDs, tasks, reviews, and activity log entries that belong to it.
- Activity log entries scoped only to the workspace (not to a specific PRD or task) are also removed.
