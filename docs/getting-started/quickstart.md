# Quickstart

This guide gets you from source checkout to a working `depot` project.

## Requirements

- Bun `>=1.0`

## Install dependencies

```bash
bun install
```

## Run the CLI locally

```bash
bun run depot -- --help
```

## Global flags

```bash
depot [--debug] [--json] <command>
```

- `--debug` enables verbose debug output to stderr
- `--json` switches all output to machine-readable JSON (see `../json-output.md`)

## Initialize a project

From the repository or workspace you want to track:

```bash
bun run depot -- init
```

By default, `depot`:

- uses the current folder name as the project name
- links the current directory as a workspace
- stores its SQLite database at `~/.depot/depot.db`

You can also provide explicit values:

```bash
bun run depot -- init my-project --description "Local agent workflow" --label "main workspace"
```

## Create a PRD

```bash
bun run depot -- prd create --title "Core CLI foundation" --context "Need durable agent state" --scope "Initial project, PRD, task, log, and handoff flow"
```

## Commit and activate the PRD

```bash
bun run depot -- prd list
bun run depot -- prd commit <prd-id>
bun run depot -- prd activate <prd-id>
```

## Add a task

New tasks must use a structured description with `Intent:`, `Scope:`, and `Non-goals:` sections:

```bash
bun run depot -- task add \
  --prd <prd-id> \
  --title "Implement handoff output" \
  --desc $'Intent:\nBuild a readable summary for the active workspace.\n\nScope:\n- Include active PRD and task progress.\n- Include recent activity.\n\nNon-goals:\n- Do not redesign the handoff format.' \
  --criteria "Handoff includes active PRD\nHandoff includes task progress" \
  --effort m
```

## Work the task

```bash
bun run depot -- task list
bun run depot -- task start <task-id>
bun run depot -- log add note --task <task-id> --payload '{"message":"Started implementation"}'
bun run depot -- task done <task-id>
```

## Generate a handoff

```bash
bun run depot -- handoff
```

The handoff output is designed to be readable in the terminal and easy to paste into a fresh agent session.

## Render live agent context

```bash
bun run depot -- context
bun run depot -- context prd
bun run depot -- context dev
bun run depot -- context review
```

## Run a review

```bash
bun run depot -- review start
bun run depot -- review activate <review-id>
bun run depot -- context review
bun run depot -- review findings <review-id> \
  --findings '[{"title":"Missing validation","severity":"major","description":"Input X is not validated"}]'
# Human only:
bun run depot -- review decide <review-id> --decision approved
```

## Install slash commands for OpenCode or Claude Code

```bash
bun run depot -- install --all
```

This writes `depot-prd`, `depot-dev`, and `depot-review` command files that call `depot context <mode>` through the `depot` binary available on your `PATH`.

## Inspect projects and workspaces

```bash
bun run depot -- project list
bun run depot -- project show <project-id>
bun run depot -- workspace list
bun run depot -- workspace show <workspace-id>
```

## Next steps

- Read `../concepts/index.md` to understand the data model.
- Use the `../cli/` pages for command details and examples.
