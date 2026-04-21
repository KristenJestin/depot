# Init and Project Commands

These commands establish project state and inspect known projects.

## `depot init`

Initialize a project and link a local directory as a workspace.

### What it does

- resolves the target workspace path
- reuses an existing project with the same name if one exists
- otherwise creates a new project
- links the workspace path to that project

If the exact workspace path is already registered, `depot` prints the existing project and does nothing.

### Usage

```bash
depot init [name] [--path <path>] [--description <text>] [--label <text>]
```

### Examples

```bash
depot init
depot init my-project
depot init my-project --description "Agent task tracking"
depot init my-project --path ../other-repo --label "secondary workspace"
```

### Notes

- `name` defaults to the current folder name
- `--path` defaults to the current working directory
- workspace paths are normalized before storage (forward slashes, lowercase on Windows)

---

## `depot project list`

List all known projects.

### Usage

```bash
depot project list
```

### Output

Each line includes the project ID, name, and status.

If no projects exist yet, the CLI tells you to run `depot init` first.

---

## `depot project show`

Show full details for a project.

### Usage

```bash
depot project show <project-id>
```

### Output

Prints aligned key-value fields: ID, Name, Status, Description, Created, Updated.

---

## `depot project update`

Update the name, description, or status of a project.

### Usage

```bash
depot project update <project-id> [--name <name>] [--description <text>] [--status <status>]
```

### Valid statuses

`active`, `paused`, `done`

### Notes

At least one of `--name`, `--description`, or `--status` must be provided. The command errors if no changes are given.

---

## `depot project archive`

Set a project's status to `done`.

### Usage

```bash
depot project archive <project-id>
```

Errors if the project is already `done`.
