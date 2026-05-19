# Depot Web Design System

This document is the short-form guide to the depot web UI conventions. It exists
to keep new pages consistent with the existing primitives and layouts, and to
point contributors at the catalog references we draw from.

## Stack

- React 19 + TanStack Router
- Tailwind v4 (config in `vite.config.ts`)
- Base UI (`@base-ui/react`) — accessibility-first primitives
- Internal primitives in `src/web/components/ui/` — wrappers over Base UI that
  apply our tokens

## Token conventions

We follow [coss-ui's](https://coss.com/ui) semantic token model. Use these CSS
variables (defined in `src/web/styles/`) rather than hard-coded colors or
spacing:

- Colors: `background`, `foreground`, `card`, `card-border`, `primary`,
  `secondary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`.
- Spacing scale: `--spacing-1` … `--spacing-12`.
- Radius scale: `--radius-sm`, `--radius`, `--radius-lg`.
- Font scale: `--font-size-xs` … `--font-size-2xl`, `--leading-*`.

Never hard-code hex colors. If a value is one-off, prefer a Tailwind utility
that resolves through the token (e.g. `bg-primary text-primary-foreground`).

## Primitives

All shared primitives live under `src/web/components/ui/`. When adding a new
one:

1. Start from the [coss-ui catalog](https://coss.com/ui/docs). Copy the source
   verbatim — that's the model — then adjust imports and tokens.
2. Keep the exported name aligned with the consumer code (don't rename without
   a search-and-replace).
3. Forward `className` so callers can extend with extra utility classes.

## Layouts

We assemble pages from a small set of layouts from
[devl.dev](https://www.devl.dev):

| Route family                                   | Layout                                 | Notes                                                                   |
| ---------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------- |
| App shell (`__root.tsx`)                       | `app-shell` / `workspace-rail`         | Sidebar projects + main content.                                        |
| PRD detail (`prds.$id.tsx`)                    | `three-pane`                           | Left: tasks/phases. Center: PRD content. Right: activity + reviews.     |
| Review diff (`prds.$id.review-diff.tsx`)       | `split-resizable` + `floating-toolbar` | Left: context. Center: diff. Right: annotations. Toolbar pinned bottom. |
| Project settings (`projects.$id.settings.tsx`) | `docs-tree`                            | Tree sidebar (config / directives / profiles) + main form pane.         |

When a new page doesn't fit one of these, default to the simplest one that
works (typically `app-shell` with a single content column) and don't invent a
new layout.

## Pattern libraries

These cover the small-but-important UI elements:

- **Timelines** — activity log rendering. Pattern from devl.dev _Timelines_
  category. Required: group by day/session, badge `source` (`ai` / `human` /
  `plugin`), expansion for Bash output.
- **Empty states** — every list that can be empty needs one. Pattern from
  devl.dev _Empty States_ category. Required: clear next-action button.
- **Toasts** — `<TriggerActionButton>` (web ↔ chat bridge) emits these.
  Pattern from devl.dev _Toasts & Banners_ category. Required: secondary
  "Copy slash command" button for the level-1 fallback.
- **Tables** — PRD list, doc artifact list. Pattern from devl.dev _Tables_
  category. Required: sortable headers, density toggle, row hover.
- **Settings forms** — project config editor. Pattern from devl.dev _Settings_
  category. Required: granular save (per-key) plus reset-to-default.

## Adding a new page

1. Pick the layout from the table above (or default to `app-shell`).
2. Compose primitives from `src/web/components/ui/` — don't reach for raw
   `<button>` or `<input>`.
3. Use semantic tokens for every visual property.
4. Empty / loading / error states are mandatory. Use the standard
   `<EmptyState>` primitive.
5. Add a Playwright smoke test if the page is on a critical path.

## Adding a new primitive

1. Find the closest match on [coss-ui](https://coss.com/ui/docs).
2. Copy the JSX into `src/web/components/ui/<name>.tsx`.
3. Replace any hard-coded colors with tokens; remove any deps the catalog brings
   but we don't want.
4. Export with a stable name. Document the props inline if non-obvious.

## Migration ledger

Pages migrated to the system (as of this commit):

- **App shell** — Sidebar + main content, no top nav. Workspace switcher,
  project nav, PRD list. (`src/web/components/app-shell.tsx`,
  `src/web/routes/__root.tsx`)
- **Overview** — Dashboard with pending actions panel + kanban board, plus
  Docs / Settings links in the header when a workspace is selected.
- **PRD detail (`/prds/:id`)** — Three-pane composition: tasks/phases left,
  PRD content center, activity/reviews right. "Review the diff" CTA in top
  bar.
- **Review diff (`/prds/:id/review-diff`)** — `split-resizable` layout
  (context panel + diff, divider draggable, width persisted in localStorage)
  - `floating-toolbar` (commit / push / submit review pinned to bottom).
- **Project settings (`/projects/:id/settings`)** — `docs-tree` layout:
  Configuration / Directives sections accessible via a sidebar tree.
- **Project docs (`/projects/:id/docs`)** — Grouped artifact lists (ADR /
  CONTEXT / Glossary / Freeform) + read-only doc-profiles + sync history.

Pages that may still benefit from further polish in a future iteration:

- Activity timeline grouping by day/session (currently flat).
- Empty-state homogenization across all list views.
- Toast / banner pattern unification (we have ad-hoc ones; coss-ui has a
  consistent palette to copy from).
- Mobile / responsive sweep (desktop-only today by design).

The migration is functionally complete; further work is polish, not blocker.
