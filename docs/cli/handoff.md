# Handoff Command

`depot handoff` generates a structured plaintext summary for the current workspace.

## Usage

```bash
depot handoff
```

## What it needs

The current working directory must resolve to a registered workspace. If no workspace matches the current directory, the command exits and tells you to run `depot init` first.

## What it includes

When a workspace has an active PRD, the current handoff output includes:

- a header with the project name and workspace label or path
- the active PRD title and revision
- task progress counts
- the current in-progress task, if any
- blocked tasks, if any
- the 10 most recent activity entries
- the next recommended pending task whose dependencies are already satisfied

When there is no active PRD, the handoff still includes recent activity and a prompt to review available PRDs.

## Output characteristics

- plaintext, not JSON
- deterministic section order
- terminal-readable
- easy to paste into a fresh agent session

## Example flow

```bash
depot handoff
depot prd list
depot task list
```

The current implementation also ends with a short resume hint for the next session.
