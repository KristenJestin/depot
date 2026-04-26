# Context Command

`depot context` renders live agent context for the current workspace.

It connects stored workflow state to the prompts used by orchestrator, coder, and auditor agents.

## `depot context`

Without a mode, the command prints an index for four supported modes:

- `prd`
- `dev`
- `coder`
- `auditor`

Each section includes:

- a one-line usage summary
- a short dynamic status derived from workspace state
- the exact detail command

If the current directory does not resolve to a workspace, `depot context` silently creates a project and workspace for the current path before rendering the index.

`depot context` does not support `--json` output. Passing `--json` returns an `unsupported` error.

## `depot context prd`

Render the product-framing context for the current workspace.

### Usage

```bash
depot context prd [prd-id]
```

If no `prd-id` is provided, the command renders non-terminal PRDs for the project together with the embedded PRD agent instructions.

If a `prd-id` is provided:

- `draft`: continue the editable PRD
- `ready`: explain that editing should continue in a forked draft revision
- `in_progress`, `done`, or `canceled`: fail with an explicit error

When multiple revisions exist in the same family, the revision chain is displayed.

## `depot context dev`

Render the orchestrator context for an active or targeted PRD.

### Usage

```bash
depot context dev [prd-target]
```

`prd-target` is optional. If provided, it resolves first by exact PRD ID, then by case-insensitive title substring.

### Output

- active or targeted PRD with context and scope
- task progress summary
- in-progress task
- blocked tasks
- recent workspace activity
- next recommended task
- embedded orchestrator instructions

If multiple `in_progress` PRDs exist in the same workspace, the command fails with a conflict message.

If a specific target is provided, the renderer also checks whether the PRD can be launched in dev mode.

## `depot context coder`

Render the implementation context for the coder sub-agent.

### Usage

```bash
depot context coder <prd-id> [--review <review-id>]
```

`prd-id` is required.

- without `--review`, the command shows pending PRD tasks
- with `--review`, it shows pending tasks for that review, including severity when present

## `depot context auditor`

Render the audit context for the auditor sub-agent.

### Usage

```bash
depot context auditor <prd-id>
```

`prd-id` is required.

### Output

- PRD with context and scope
- completed and skipped tasks for the PRD
- the last agent review and its findings
- embedded auditor instructions

## Notes

- the templates used by these contexts are embedded at build time from `src/modules/context/templates/*.md`
- the command is text-first by design
- the mode registry contains exactly `prd`, `dev`, `coder`, and `auditor`
