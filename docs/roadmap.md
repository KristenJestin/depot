# Roadmap

This roadmap describes the direction implied by the current codebase. It does not replace the code as the source of truth.

## Now

- bring the source runner, bundled CLI, and help output into line
- make the `serve` path more predictable by tightening how web assets are built and packaged
- keep the local SQLite workflow robust, migration-safe, and deterministic
- improve command-level consistency across text output, JSON output, and error handling
- close obvious lifecycle edge cases around destructive operations and linked records

## Next

- improve PRD authoring ergonomics, especially around structured task descriptions and batch loading
- expand project and workspace browsing beyond the current CRUD baseline
- deepen review and handoff workflows around the `dev`, `coder`, and `auditor` contexts
- extend the web UI beyond the current read-only PRD list and PRD detail views
- add better visibility into blocked work, dependency bottlenecks, and stale execution state

## Later

- add richer import, export, backup, and snapshot flows for long-lived project state
- expand the web UI from read-only inspection toward broader workflow visibility
- explore stronger multi-agent coordination patterns on top of the same local model
- add more diagnostics and recovery tooling for broken or partially-complete state
- revisit broader distribution and packaging options once the runtime story is stable

## Themes

The same themes continue to drive the project:

- local-first state instead of chat-only memory
- explicit transitions instead of implicit workflow guesses
- terminal-first execution with machine-readable escape hatches
- a single data model shared by CLI, context rendering, and web views
- small, inspectable primitives that can support richer orchestration later
