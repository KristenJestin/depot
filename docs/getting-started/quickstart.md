# Quickstart

This guide gets you from a source checkout to a working `depot` workspace.

The examples below use `depot` as if the binary is already on your `PATH`. In a local checkout, the most reliable path is to build the bundle and run `node dist/index.mjs` instead.

## Requirements

- Bun for install, build, and contributor workflows
- Node `>=25` to run the built CLI bundle

## Install And Build

```bash
bun install
bun run build
node dist/index.mjs --help
```

If you want to follow the examples exactly from a checkout, replace each `depot` invocation with `node dist/index.mjs`.

## Global Flags

```bash
depot [--debug] [--json] <command>
```

- `--debug` enables verbose debug output on stderr
- `--json` switches supported commands to machine-readable output on stdout

See `../json-output.md` for the JSON contract.

## Initialize A Project And Workspace

From the repository or directory you want to track:

```bash
depot init my-project --label "main workspace"
```

A few details are worth knowing:

- the CLI currently requires an explicit project name
- `--path` defaults to the current working directory
- the database defaults to `~/.depot/depot.db`

You can also give the project a description or point at a different path:

```bash
depot init my-project --description "Local agent workflow" --path ../other-repo
```

## Create And Activate A PRD

```bash
depot prd create --title "Core CLI foundation" --context "Need durable agent state" --scope "Project, PRD, task, review, and log flow"
depot prd list
depot prd ready <prd-id>
depot prd activate <prd-id>
```

`depot prd list` shows the latest revision of each PRD family for the current project.

## Add A Task

The `task add` command currently uses camelCase flag names, most notably `--prdId`.

At minimum, your description should follow this structure:

```text
Intent:
Render a live workspace summary.

Scope:
- Include the active PRD.
- Include recent activity.

Non-goals:
- Do not redesign the output format.
```

Then create the task:

```bash
depot task add --prdId <prd-id> --title "Implement context command" --desc "<structured description>" --criteria "Context renders the active PRD\nContext renders recent activity" --effort m
```

If you prefer to create a PRD and all of its tasks in one shot, use `depot prd load` with a JSON document.

## Work The Task

```bash
depot task show <task-id>
depot task start <task-id>
depot log add note --task <task-id> --payload '{"message":"Started implementation"}'
depot task done <task-id>
```

`depot task show` is the detailed spec view. `depot context dev` is only a summary.

## Run The Review Loop

```bash
depot review start <prd-id> --type agent
depot review task add <review-id> --title "Missing edge-case handling" --description "Handle the empty-state branch explicitly." --doneCriteria "Empty-state behavior is covered" --severity major
depot review begin <review-id>
depot review done <review-id>
```

Reviews now stay in `draft` while you are still collecting or refining findings. Use `depot review begin` once the review draft is validated and ready to drive the next implementation pass.

## Render Live Agent Context

```bash
depot context
depot context prd
depot context dev
depot context coder <prd-id>
depot context auditor <prd-id>
```

`depot context` turns stored workflow state into agent-ready prompts.

## Install Slash Commands

```bash
depot install --all
```

This writes `depot-prd.md` and `depot-dev.md` command files for supported agents. Those files inject `depot context <mode>` output directly into the prompt, so the agent receives fresh depot state immediately.

## Start The Web UI

```bash
bun run build:web
depot serve --port 4242
```

The `serve` command expects built frontend assets in `dist/web`. From a source checkout, `bun run build` builds the CLI bundle, while `bun run build:web` builds the frontend.

## Inspect Stored State

```bash
depot project list
depot project show <project-id>
depot workspace list
depot workspace show <workspace-id>
depot log list --workspace
```

## Next Steps

- Read `../concepts/index.md` for the full model and lifecycle rules.
- Use the `../cli/` pages for command-specific details.
- Read `../architecture/overview.md` if you are changing the implementation.
