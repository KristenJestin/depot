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
- workspace paths are normalized before storage

## `depot project list`

List all known projects.

### Usage

```bash
depot project list
```

### Output

Each line includes:

- a shortened project ID
- the project name
- the project status

### Example

```bash
depot project list
```

If no projects exist yet, the CLI tells you to run `depot init` first.
