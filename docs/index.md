# depot

`depot` is a local-first CLI and small web UI for managing agent work as durable project state.

It turns the parts of agent execution that usually disappear into chat history into explicit records in a local SQLite database: projects, workspaces, PRDs, tasks, reviews, and activity events. The CLI is the primary interface. The web UI served by `depot serve` is a read-only view of the same data.

## Why depot exists

Agents are good at moving work forward, but weak at preserving clean state across sessions.

Once a conversation resets, the state of the work is often split across:

- prompts
- local notes
- branches
- half-complete PRDs
- untracked review feedback

`depot` turns that into explicit, queryable structure:

- Projects group work at the top level.
- Workspaces bind projects to canonical paths on disk.
- PRDs define why a body of work exists and what it should cover.
- Tasks make execution ordered, dependency-aware, and inspectable.
- Reviews capture findings and the follow-up loop.
- Activity logs record what happened while the work was moving.
- Context commands package that state for orchestrator, coder, and auditor agents.

## What Depot Does Today

Today, the application supports:

- initializing and reusing project or workspace state with `depot init`
- managing projects with `depot project ...`
- managing workspaces with `depot workspace ...`
- creating, revising, loading, activating, and closing PRDs with `depot prd ...`
- creating and executing dependency-aware tasks with `depot task ...`
- running human or agent review loops with `depot review ...`
- recording structured activity with `depot log ...`
- rendering live agent context with `depot context`
- installing agent integrations for OpenCode, Claude Code, and Codex with live depot context via `depot install`
- serving a small web UI and JSON API with `depot serve`

## Core Model

`depot` is built around a small number of persistent concepts:

- A project is the top-level container.
- A workspace links a project to a canonical absolute path.
- A PRD belongs to a project, may later be attached to a workspace, and can be revised through a family chain.
- A task belongs to a PRD and moves through explicit execution states.
- A review belongs to a PRD and stores findings as tasks.
- The activity log stores structured events tied to a project and optionally a workspace, PRD, or task.

The same database powers the CLI, the context commands, and the web UI.

## Documentation Map

- Start with `getting-started/quickstart.md` for the fastest path from checkout to first use.
- Read `concepts/index.md` for the mental model and lifecycle rules.
- Use the `cli/` pages for command-level reference.
- Read `architecture/overview.md` for the implementation shape of the app.
- Read `json-output.md` for the machine-readable output contract.
- Check `roadmap.md` for the direction implied by the current codebase.
