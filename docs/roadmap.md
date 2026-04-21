# Roadmap

This roadmap reflects the current direction of `depot` without redefining the behavior already implemented in the codebase.

## Now

- Strengthen the handoff experience so it becomes the default resume point for agent sessions.
- Improve CLI output consistency and readability across commands.
- Expand command coverage around projects, logging, and workspace-aware status inspection.
- Tighten validation rules and mechanical workflow guarantees.
- Keep the local SQLite workflow robust and predictable.

## Next

- Add richer project and workspace management beyond the current `init` and `project list` flow.
- Improve PRD authoring and revision workflows while keeping transitions explicit.
- Add more structured output contracts, especially for machine-oriented consumers.
- Expand observability around stalled work, broken dependencies, and incomplete execution state.
- Clarify installation and packaging paths beyond source-based Bun usage.

## Later

- Explore a broader context command that bundles the right state for a given mode.
- Add stronger operational tooling such as diagnostics, snapshots, and read-only views.
- Revisit distribution as compiled binaries and multi-platform artifacts.
- Explore more advanced workflow patterns such as richer review loops and multi-agent coordination.
- Reassess portability, backup, and import or export stories for long-lived project state.

## Themes carried forward

The roadmap continues to prioritize the same core themes already present in earlier planning:

- better task and PRD execution workflows
- clearer CLI UX and output contracts
- stronger reliability around storage, migrations, and recovery
- better documentation and onboarding
- room for future observability and distribution improvements
