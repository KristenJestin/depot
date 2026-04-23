# Context Command

`depot context` renders live agent context for the current workspace.

## `depot context`

Without a mode, the command prints an index for the four supported modes:

- `prd`
- `dev`
- `coder`
- `auditor`

Each section includes:

- a one-line usage summary
- a short dynamic status derived from the current workspace state
- the exact detail command

If the current directory does not resolve to a workspace, `depot context` silently creates a project and workspace for the current path before rendering the index.

`depot context` does not support `--json` output. Passing `--json` returns an unsupported error.

---

## `depot context prd`

Renders the product framing context for the current workspace.

### Usage

```bash
depot context prd [prd-id]
```

If no `prd-id` is provided, renders all active PRDs for the project with the PRD agent instructions.

With `prd-id`:

| PRD status              | Behavior                                          |
| ----------------------- | ------------------------------------------------- |
| `draft`                 | Displays the PRD and continues Q&A                |
| `ready`                 | Indicates a fork (v2) will be created for editing |
| `in_progress` or beyond | CLI errors with an explicit message               |

The revision chain (via `rootId`) is displayed when multiple revisions exist.

---

## `depot context dev`

Renders the execution context for the active PRD. Acts as the **orchestrator** entry point.

### Usage

```bash
depot context dev [prd-target]
```

`prd-target` is an optional second positional argument. If provided, it is resolved first by exact PRD ID, then by case-insensitive substring match on the title.

### Output

- active PRD with context and scope
- progress summary (done/total · in progress · blocked · pending · skipped)
- current task with spec summary and done criteria
- blocked tasks
- recent activity (last 10 entries)
- next recommended task
- orchestrator instructions (coder → auditor → human validation loop)

If multiple `in_progress` PRDs exist in the same workspace, the command fails with a conflict list.

---

## `depot context coder`

Renders the implementation context for the coder sub-agent.

### Usage

```bash
depot context coder <prd-id> [--review <review-id>]
```

`prd-id` is required. No auto-resolution.

- Without `--review`: displays pending PRD tasks.
- With `--review`: displays pending tasks belonging to that review (with severity).

---

## `depot context auditor`

Renders the audit context for the auditor sub-agent.

### Usage

```bash
depot context auditor <prd-id>
```

`prd-id` is required. No auto-resolution.

### Output

- PRD with context and scope
- Done/skipped tasks since last audit
- Last agent review and its tasks

---

## Replacement note

`depot context` replaces the old `depot playbook` command surface.
