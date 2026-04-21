# depot

`depot` is a Bun-based CLI for managing agent work as structured project state.

It gives local, durable structure to work that would otherwise live in chat history: projects, workspaces, PRDs, tasks, and activity logs. The CLI is designed for terminal-first execution and local ownership, with a SQLite database stored on the machine running the agent.

## Why depot exists

Coding agents are good at executing work, but weak at preserving context across sessions. When a chat resets or a different agent takes over, the current state of the work is often scattered across prompts, markdown notes, and half-finished branches.

`depot` turns that implicit state into explicit data:

- Projects group related work.
- Workspaces bind projects to local directories.
- PRDs capture why a body of work exists and what it should do.
- Tasks make execution concrete and ordered.
- Activity logs record what happened and why.
- Handoffs summarize the current state so the next session can resume quickly.

## What it does today

The current CLI supports:

- Initializing a project from a local directory with `depot init`
- Managing PRDs with `depot prd ...`
- Managing tasks with `depot task ...`
- Recording activity with `depot log ...`
- Generating a workspace handoff with `depot handoff`
- Rendering live agent context with `depot context`
- Installing live slash commands with `depot install`

## Core ideas

`depot` is organized around a small number of stable concepts:

- A project is the top-level container.
- A workspace links a project to a canonical absolute path on disk.
- A PRD belongs to a workspace and moves through `draft`, `committed`, `in_progress`, and `archived`.
- A task belongs to a PRD and moves through `pending`, `in_progress`, `blocked`, `done`, and `skipped`.
- The activity log stores structured events tied to the current project and optionally a workspace, PRD, or task.

## Documentation map

- Start with `getting-started/quickstart.md` for installation and first use.
- Read `concepts/index.md` for the mental model.
- Use the `cli/` pages for command reference by domain.
- Read `architecture/overview.md` for an implementation-level overview.
- Check `roadmap.md` for the current product direction.
