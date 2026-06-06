# Concepts

`depot` is built around a small, explicit model for tracking agent work locally.

The core idea is not just to store tasks in SQLite. It is to make the moving parts of agent execution explicit enough that a later session, another agent, or a human reviewer can pick up the work without reconstructing state from chat history.

## Projects

A project is the top-level container.

Each project stores:

- a stable text ID generated as a monotonic ULID
- a name
- an optional description
- a status: `active`, `paused`, or `done`

Projects are created indirectly through `depot init` or managed directly with `depot project list`, `depot project show`, `depot project update`, and `depot project archive`.

## Workspaces

A workspace binds a project to a canonical absolute path on disk.

This is how `depot` knows which project you mean when you run workspace-aware commands from a directory. Resolution uses longest-prefix matching on canonical paths, so a command launched from any nested subdirectory still resolves to the correct workspace. If the path is inside a git worktree and nothing matches directly, `depot` falls back to the main worktree path before giving up.

Important properties:

- a workspace belongs to exactly one project
- workspace paths are unique across the database (stored in the `workspaces` table)
- a workspace may have an optional human label
- path normalization uses forward slashes, and lowercases paths on Windows
- workspaces are flat: `depot` does not mark one as "primary" or distinguish a worktree from its main checkout

If the current directory does not resolve to a workspace, most workspace-aware commands exit and ask you to run `depot init` (to create a new project) or `depot workspace add` (to attach the folder to an existing project).

`depot context` is the main exception: it uses auto-create mode and silently creates a project plus workspace for the current path before rendering context.

The CLI exposes `depot workspace list`, `depot workspace show`, `depot workspace rename`, `depot workspace remove`, and `depot workspace add` (alias `link`) to attach an existing folder to an existing project.

## Project Repos

A project repo is an optional registry entry that names a git repo belonging to a project, so `depot` can target it for git-aware operations.

Project repos live in the `project_repo` table. Each row stores:

- the project it belongs to
- a `name` unique within the project (for example `front`, `api`, `common`)
- a `path` (absolute, or relative to the workspace)
- a base branch

When the registry is empty for a project, `depot` falls back to a single **implicit repo** rooted at the workspace path. There is no auto-discovery of sibling repositories: anything beyond the implicit case must be registered explicitly with `depot project repo add`.

### Two ways to map a project to disk

Both modes use the same model — only the contents of `project_repo` change.

**Mono-repo (classic).** The project folder _is_ a git repo. One workspace points at it, the project has no `project_repo` rows, and the implicit repo covers all git operations.

```
~/code/my-app          ← workspace, also the git repo (implicit project_repo)
  ├── .git
  ├── src/
  └── package.json
```

**Multi-repo (shell root).** The workspace folder is a "shell" that holds agent configuration (`CLAUDE.md`, `.claude/`, scripts) and may have its own `.git`. The actual code lives in sibling sub-folders, each its own git repo with its own remote, registered as `project_repo` rows with paths relative to the workspace.

```
~/code/platform        ← workspace (shell root; may carry its own .git for config)
  ├── CLAUDE.md
  ├── api/             ← project_repo "api"     (path "api")
  ├── front/           ← project_repo "front"   (path "front")
  └── common/          ← project_repo "common"  (path "common")
```

### Things `depot` does not do

`depot` tracks where the code lives so it can route git-aware actions. It does not set up that code. In particular:

- `depot` never creates or deletes a folder on disk. `depot init` and `depot workspace add` register an existing path; they do not materialise one.
- `depot` does not create or remove git worktrees, copies of the project, branches, or development environments. That belongs to your shell tooling, IDE, or an external skill.
- `depot` does not enforce a branch-naming convention or pick a branch for you.

When a worktree or sibling clone is created externally, attach it with `depot workspace add --project <id|name>` so `depot` can resolve it.

## PRDs

A PRD belongs to a project. It captures why a body of work exists and what is in scope.

Before activation, a PRD belongs only to the project. Its `workspaceId` remains `null` until `depot prd activate` attaches it to the current workspace.

The lifecycle is:

- `draft`
- `ready`
- `in_progress`
- `done`
- `canceled`

The validator allows these status transitions:

- `draft -> ready`
- `draft -> canceled`
- `ready -> in_progress`
- `ready -> canceled`
- `in_progress -> done`
- `in_progress -> canceled`

Key behaviors:

- `depot prd create` creates a draft PRD.
- `depot prd update` updates a draft PRD in place.
- `depot prd ready` marks a draft PRD as ready.
- `depot prd activate` moves a ready PRD to `in_progress` and attaches it to the current workspace.

### One active PRD per workspace

`depot prd activate` enforces a hard rule: a workspace can have **at most one PRD in status `in_progress` at any time**. Attempting to activate a second PRD against the same workspace fails with `WorkspaceAlreadyHasActivePrdError`, naming the PRD that already holds the slot.

This is what makes the workspace the unit of agent focus: the activated PRD plus its workspace path are how `depot` knows what the current session is supposed to be working on. To work on a second PRD in parallel, attach a different folder (typically a git worktree) as a separate workspace with `depot workspace add`, and activate the second PRD from there.

### Revisioning

PRDs are revisioned as families.

Each PRD row stores:

- `rootId`: the original revision in the family
- `parentId`: the immediate prior revision
- `revision`: the revision number

The shape is:

```text
v1 : rootId = v1.id, parentId = null,  revision = 1
v2 : rootId = v1.id, parentId = v1.id, revision = 2
v3 : rootId = v1.id, parentId = v2.id, revision = 3
```

Forking is explicit. `depot prd fork <prd-id>` creates a new `draft` revision from a `ready` PRD. The original revision stays `ready`; the fork becomes the new editable branch of the family.

`depot prd list` shows only the latest revision of each family, not every historical row.

### Batch PRD Loading

`depot prd load` creates a PRD and all of its tasks in one SQLite transaction.

The JSON format uses `dependsOn` as zero-based task indexes inside the same document. Only backward references are allowed, so task 4 may depend on task 1, but task 1 may not depend on task 4.

## Ideas

An idea is the lightweight, project-scoped capture point that sits _before_ a PRD.

A PRD is a commitment: creating one — even a `draft` — already means the work is going to be built. An idea is the opposite. It is a thought you want to keep so you don't forget it, that you may never build. Modeling it as a separate entity keeps the invariant that **every PRD row is a commitment to build** intact, instead of polluting `prd list` with drafts that never aim at `ready`.

An idea is deliberately thin: a title, an optional markdown body, and an optional single kebab-case tag for grouping. There is no priority, effort, or assignee — wanting any of those _is_ the signal to promote.

Its lifecycle is a triage machine, not a commitment machine:

- `open`
- `promoted`
- `dropped`

The allowed transitions are:

- `open -> promoted` (became a draft PRD; the moment of commitment)
- `open -> dropped` (decided against or no longer relevant)
- `dropped -> open` (undo a drop)

`promoted` is terminal. Dropping needs no reason — ideas are _meant_ to die — though one can be recorded.

Key behaviors:

- `depot idea add <title>` captures an idea (the only required field is the title; `--body` / `--body-file -` add a rationale, `--tag` groups it).
- `depot idea list` shows open ideas newest-first with their age, and prints an open-count footer so parked thoughts resurface.
- `depot idea show`, `depot idea edit`, `depot idea drop`, and `depot idea reopen` round out triage.
- `depot idea promote <id>` is the single bridge into the committed world. It mints a `draft` PRD seeded from the idea (title plus body as context, carrying the idea's tag), flips the idea to `promoted`, and records `promotedPrdId`.

### Two relations between ideas and PRDs

Ideas and PRDs are connected by two distinct, non-collapsible relations:

- `idea.promotedPrdId` answers _"which PRD did this idea become?"_ It is idea-centric, set once by `promote`, and at most one per idea.
- the `prd_ideas` join answers _"which ideas motivated this PRD?"_ It is PRD-centric source material, an M:N relation attached to the **logical** PRD (like tags and dependencies) so it survives forks. Referencing an idea does **not** change its status: a parked `open` idea can inform a PRD without being consumed.

`promote` does both at once — it marks the idea `promoted` and inserts a `prd_ideas` row so the new PRD lists its originating idea.

`depot prd idea add`, `depot prd idea remove`, and `depot prd idea list` manage the reference join directly. `depot context prd` surfaces linked source ideas inline (title plus full body) so the PRD agent reads the raw, uncommitted need before framing, and it shows an open-idea recall count. The `dev`, `coder`, and `auditor` contexts deliberately do not render ideas.

## Tasks

Tasks belong to a PRD and represent concrete execution units.

Each task includes:

- a title
- a description
- required `doneCriteria`
- an effort estimate: `xs`, `s`, `m`, `l`, or `xl`
- an ordered `position` within the PRD
- optional task dependencies stored as a JSON array of task IDs
- an optional `reviewId` when the task is a review finding
- an optional `severity` when the task belongs to a review

New task descriptions are normalized to the `structured_v1` storage path:

- `Intent:` why this task exists now
- `Scope:` what should change or be verified
- `Non-goals:` what should not be pulled into the task

There is currently no `--desc-format` flag for choosing another format when creating or
updating tasks. Plain text input is still accepted and trimmed, but new task rows store
`descriptionFormat` as `structured_v1`. If the content does not include the full
`Intent`, `Scope`, and `Non-goals` shape, `depot task show` renders it under a single
`Description` section. Older freeform descriptions remain readable.

The task lifecycle is:

- `pending`
- `in_progress`
- `blocked`
- `done`
- `skipped`

Allowed transitions are:

- `pending -> in_progress`
- `pending -> skipped`
- `in_progress -> done`
- `in_progress -> blocked`
- `blocked -> in_progress`
- `blocked -> skipped`

Important behaviors:

- `doneCriteria` must be non-empty
- a task must be started before it can be completed
- a task can only be completed when all dependency tasks are already `done` or `skipped`
- blocking and skipping both require an explicit reason
- review findings are stored in the same `tasks` table as regular execution tasks

## Reviews

A review belongs to a PRD and models the feedback loop around implementation.

The lifecycle is:

- `draft`
- `in_progress`
- `done`

Two review types exist:

- `agent`
- `human`

Findings are not stored as separate blobs. They are stored as tasks with `reviewId` set and, optionally, a severity of `critical`, `major`, `minor`, or `info`.

Important behaviors:

- `depot review start` creates a review in `draft`
- findings can be added while the review stays in `draft`
- `depot review begin` validates the review draft and moves it to `in_progress`
- `depot review done` can close either an `in_progress` review or an empty `draft` review

The schema also includes a `userFeedback` field for human context, but the CLI does not yet expose a direct write path for it.

## Prototypes And The Design Lock

A PRD revision can carry **prototypes** — iterative UI exploration in the
hierarchy `Prototype → Page → Version → Variant`. Variants are deliberately
divergent ("radically different" layouts); each `(page, version)` flags one
`is_main` as a _within-tree primacy hint_ (what the viewer shows by default).

`is_main` is a hint, not a decision. The **decision** is a separate, first-class
concept introduced by the design lock, and it is scoped to a `(round, page)` (see
_The round is the unit_ below):

- **Election** — `depot prd prototype variant elect <variantId> --rationale "…"`
  records, per `(round, page)`, the single variant chosen for implementation,
  together with the arbitration (`rationale` / `decidedBy` / `decidedAt`).
  Distinct from `is_main`; cleared automatically if the elected variant is
  removed. Election is the **user's** decision; the agent only recommends.
- **Distillation** — `depot prd prototype distill <pageId> [--round …] --spec "…"`
  writes that page's **placement spec** ("where everything goes, in what order")
  into a `prd_round_page_design` row for the `(round, page)`. This is the contract
  the dev/coder agent reads — never the raw mockup.

These converge the exploration before the PRD enters the commitment lifecycle.
`depot prd ready` runs a **design-lock gate**: when the revision has prototypes,
it refuses while any page decided in the current round still lacks a placement.
The gate is soft and shuntable with `--skip-design-lock`, mirroring the
`prd done` ship-readiness gate at the other end of the lifecycle. The intent is
that **the variant arbitration and the placement happen before `ready`, never as
a task left for an implementation phase**.

### Versions vs. Rounds

Two axes hide behind the word "version", and `depot` separates them:

- A **version** is an iteration of **one page**. Each page has its own unbounded
  timeline ("v1", "v2", "v3-feedback-round-1"); a version is never re-created for
  a page that did not change.
- A **round** is a round of the **whole design** — the user's "v1"/"v2". It is
  a named **manifest** that pins exactly one existing version per page it
  includes. A round is a horizontal cut across the per-page timelines: home can
  be on its 3rd iteration while settings is still on its 1st, and the round
  records which iteration of each ships together.

Keeping the words straight matters: when someone says "v1 / v2" they mean a
round, not a page version. The labels "v1"/"v2" belong to rounds.

### The round is the unit

The **round is the unit** the user sees and iterates — never the page version.
A round is the whole design at one instant: the group of pages validated
together. The user navigates rounds (`v1 / v2 / v3…`) and reasons about the
design as a group; the per-page **version is a hidden mechanism**, present only
so unchanged pages can carry forward between rounds.

**Feedback ⇒ a new round.** Any feedback — on one page or several — opens a new
round rather than mutating the one on screen. Changed pages take a new version;
unchanged pages are **reused as-is by pointer**, so a fresh round is cheap: the
manifest is pins, never copied HTML. Reasoning "about the whole group" is
therefore free. One round ≈ one feedback / validation pass.

Compositional feedback — "the header from B with the sidebar from C" — is just
feedback: the agent **synthesises** the requested layout and opens a **new
round** carrying it. There is no notion of "one variant locked in a block" the
user has to live with; the **variant** is divergent exploration _within_ a round
(the user elects one per page, or a single-variant page is **retained by
default**), and convergence is always expressed as the next round.

This **amends the mutable current round of the rounds model**: where iterating a
page used to advance the current round's pin in place, a round is now treated as
a **frozen snapshot** and each feedback pass opens a new one. The data bricks are
unchanged — a round still clones as pointers and a changed page still takes a new
version — so the shift is a **workflow convention and agent protocol**
("feedback ⇒ new round, never mutate the current one"), with the web UI showing
only rounds.

### Round membership and the dropped page

**Membership is row presence.** A round manifest holds one row per included
page; a page with no row is **dropped** for that round. Nothing is deleted —
the page and its full version history remain, the page simply does not ship in
that round. This is what gives a round the property the model exists for:
dropping a page from a later round without losing it, and browsing an earlier
round ("v1 = 10 pages") as a coherent set after moving on ("v2 = 8 pages").

Opening a new round clones the previous round's manifest (the pins, never the
HTML — no version is duplicated), then adjusts membership: **drop** pages this
round won't ship, or **include** pages explicitly. There is no `freeze` step;
**earlier rounds are frozen by construction**, because their pins never change
once a newer round exists. Each round keeps pointing at its own row of every
page's timeline. A page that was dropped is not silently re-included by a later
round; re-inclusion is an explicit act.

The data layer still allows advancing the current round's pin in place, but the
**convention is feedback ⇒ a new round** (see _The round is the unit_): the
current round is treated as a frozen snapshot, and a new iteration of a page is
carried by a new round rather than by mutating the one the user just validated.

### Round-relative resolution

Resolving an inter-page link (`data-depot-page="settings"`) is **round-relative**.
It resolves against a round — the current one by default — by looking up that
round's manifest entry for the page and showing the pinned version's elected or
main variant. A page that is not in the resolved round's manifest yields a
defined **`dropped` outcome** ("removed in this round"), not an error: the drop
is an intentional state, not a broken link. (Only a slug that never existed is an
error.) Because resolution is now round-relative, the manifest pin is what
decides which iteration is shown — archiving the pinned version no longer falls
back to an earlier active version.

### Election and placement live on the `(round, page)`

Both the **election** (chosen variant + rationale) and the **distilled
placement** belong to the `(round, page)`, not the page. Each round carries its
own decisions, so cloning a round never drags a stale choice across:

- Election sits on the round's manifest entry (`prd_prototype_round_pages`), read
  cheaply on every render.
- The placement sits in its own `prd_round_page_design` table, keyed by
  `(round_id, page_id)`. The potentially large markdown stays off the manifest
  hot path and is loaded only when distilling or rendering the coder context.

**Inherit, then reset on advance.** Opening a new round **inherits** each page's
election and placement. The moment a page's pinned version **advances** (a new
iteration in the new round), that page's election and placement **reset** — the
decision was about the old variant, so a stale placement never lingers. Pages
whose pin is unchanged carry their validated decision forward for free. This is
automatic, keyed off the pin, with no per-page prompt.

### Distill on the fly; the `ready` gate is a fallback

The placement is distilled **per page, on the fly, the moment that page's variant
is decided in the current round** — at page creation for a single-variant page
(retained by default), or at election for a multi-variant one. There is no big
convergence pass: the agent authors one page's placement as soon as it is
decided.

`depot prd ready` no longer _triggers_ distillation; it is the **safety net**. It
evaluates only the pages in the current round's manifest and refuses if a page
decided in that round has no placement, pointing at what is missing. A page
dropped from the current round does not block.

The placement is **one markdown field, structured by convention**, not a set of
rigid columns: `## Regions` (the zones and how they are arranged), `## Order`
(component sequence within each region), `## Hierarchy` (what dominates),
`## States` (empty / loading / error / success…), and `## Interactions` (what
happens on click or input). A simple page fills two sections, a rich one six;
`distill` lightly requires at least `## Regions` and `## Order`. An LLM both
authors and reproduces a sectioned markdown far better than it would a fixed
schema.

### Pages, tasks, and the scoped handoff to the coder

A page links to the tasks that build it through `task_prototype_pages`, a plain
M:N join modeled on `task_user_stories`: "this task realises these pages." The
link is set during task authoring (`depot task page add/remove/list`) and
survives a PRD fork.

That link is what carries the validated layout to the implementer. The `coder`
and `dev` contexts render a dynamic **`{{task_placement taskId=…}}`** marker that
lists, for the task in hand, the pages it is linked to and **their placement in
the current round — and nothing else**. A 30-page PRD does not drown every coder
in everything: each task sees only the placement of the pages it builds. This is
the missing final link of the design lock — the validated layout reaches the
people who build it, scoped, instead of being captured at distill time and lost.

### Placement vs. aesthetics

The placement is the **answer** the user signed off on: where everything goes, in
what order, what dominates, what the states are. The implementer **reproduces
that layout** — and pulls the **look** from the project's design system. The
mockup HTML is a **layout reference, not pixels to copy**; prototype code is
throwaway and is rewritten properly when folded in. Aesthetics are explicitly not
the prototype's job. The `dev` and `coder` contexts state this framing plainly so
a coder reproduces the structure without shipping the mockup's styling.

## Activity Log

The activity log stores structured events tied to the current project and, optionally, a workspace, PRD, or task.

Current event types are:

- `session_start`
- `prd_created`
- `prd_updated`
- `task_created`
- `task_updated`
- `task_started`
- `task_done`
- `task_blocked`
- `task_skipped`
- `prd_activated`
- `prd_ready`
- `prd_done`
- `prd_canceled`
- `prd_forked`
- `idea_created`
- `idea_updated`
- `idea_promoted`
- `idea_dropped`
- `idea_reopened`
- `review_created`
- `review_updated`
- `review_started`
- `review_done`
- `prototype_round_created`
- `prototype_round_page_pinned`
- `prototype_round_page_dropped`
- `note`
- `error`

Each entry stores a JSON payload. `depot log add` accepts strict JSON and a looser object-like syntax, which makes shell-escaped payloads easier to work with.

## Contexts

`depot context` renders live agent context for the current workspace.

The available modes are:

- `prd`
- `dev`
- `coder`
- `auditor`
- `idea`

Without a mode, `depot context` prints an index with a short usage line, dynamic status, and the exact command to load each detailed mode.

Modes:

- `prd` packages product-framing state and the embedded PRD-agent instructions
- `dev` packages orchestrator state for the active or targeted PRD
- `coder <prd-id> [--review <review-id>]` packages implementation work for a coder agent
- `auditor <prd-id>` packages completed work and prior review state for an auditor agent
- `idea` packages the open-idea backlog and the capture/triage agent instructions, the mirror opposite of the PRD agent: it captures fast and recommends promote/keep/drop rather than grilling toward a commitment

These contexts are rendered views. They summarize and package state, but they do not themselves advance task or PRD lifecycle steps.

## Web Interface

`depot serve` exposes the same SQLite data through a small web UI.

The web layer currently provides:

- a PRD list view at `/`
- a PRD detail view at `/prds/:id`
- a small Hono API under `/api`

The web UI is read-only. It is a view over the same local database used by the CLI.

## Local-First Storage

By default, `depot` stores its database at `~/.depot/depot.db`.

Important runtime behaviors:

- the depot directory is created automatically when needed
- SQLite migrations are applied automatically on open
- the database path can be overridden with `DEPOT_DB_PATH` (the legacy `DB_PATH` is still
  honoured with a deprecation warning)
- there is no remote service dependency in the current architecture

That keeps the workflow local, deterministic, terminal-friendly, and inspectable.
