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
- the active PRD ID, title, and revision (context truncated to 300 characters)
- task progress counts (done / total · in progress · blocked · pending)
- the current in-progress task with started timestamp and done criteria, if any
- blocked tasks with their block reasons, if any
- the 10 most recent activity entries
- the next recommended pending task whose dependencies are all satisfied, with done criteria

When there is no active PRD, the handoff still includes recent activity and a prompt to review available PRDs.

## Output characteristics

- plaintext, not JSON
- deterministic section order
- terminal-readable
- safe to paste into a fresh agent session

## JSON output

When `--json` is active, `depot handoff` emits structured `HandoffData` instead of plaintext. See `../json-output.md` for the full schema.

## Example flow

```bash
depot handoff
depot prd list
depot task list
```

The output ends with a resume hint pointing to `depot context dev`.
