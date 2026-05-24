# Depot Web Design System

Short-form guide to the depot web UI conventions. It keeps new pages consistent
with the existing primitives and layouts, and points at the catalog references
we draw from.

## Stack

- React + TanStack Router (file-based routes in `src/web/routes/`)
- Tailwind v4 via the `@tailwindcss/vite` plugin; tokens live in
  `src/web/styles/globals.css`
- Base UI (`@base-ui/react`) — accessibility-first headless primitives
- Internal primitives in `src/web/components/ui/` — thin wrappers over Base UI
  that apply the depot tokens
- TanStack Query for data fetching

The stack is already aligned with [coss-ui](https://coss.com/ui) (Base UI +
Tailwind v4, copy-paste model). There is no framework migration — coss-ui is the
source we copy from, not a dependency.

## Token conventions

Tokens are defined in `src/web/styles/globals.css`: CSS custom properties under
`:root` (light) and `.dark`, re-exported as Tailwind colors inside `@theme
inline`. Use the Tailwind utilities that resolve through these tokens rather
than hard-coded values.

- Core semantic colors (coss-ui set): `background`, `foreground`, `card`,
  `card-foreground`, `card-border`, `popover`, `primary`, `secondary`, `muted`,
  `accent`, `destructive`, `border`, `border-subtle`, `input`, `ring`.
- Depot-specific roles: `success`/`warning`/`info` (+ `-soft` variants),
  `status-*` (draft/ready/in-progress/done/canceled), `task-*`,
  `severity-*` (critical/major/minor/info), `timeline-*`, `sidebar-*`.
- Radius scale: `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-xl`,
  `--radius-2xl`, derived from a single `--radius` base.
- Fonts: `--font-sans` (Inter Variable), `--font-mono`.

Light and dark variants are both defined; no user-facing theme toggle is wired
(out of scope — see PRD 14 Notes). Never hard-code hex/oklch colors in
components. A handful of custom utility classes exist for surfaces that Tailwind
can't express directly: `bg-panel-muted`, `border-card-border`, `shadow-card`,
`shadow-card-hover`, `depot-logo-gradient`.

## Primitives

Shared primitives live in `src/web/components/ui/`:

- Form / control: `button`, `input`, `textarea`, `checkbox`, `select`
- Surface / container: `card`, `side-drawer`, `accordion`, `collapsible`,
  `collapse-chevron`
- Status / data: `badge`, `status-badge`, `status-dot`, `task-indicator`,
  `empty-state`
- Layout: `resizable-panel` (exports `ResizableSplit` + `FloatingToolbar`)
- Navigation: `breadcrumb`
- Feedback: `dot-loader/` (loading spinner)

When adding a new primitive:

1. Find the closest match in the [coss-ui catalog](https://coss.com/ui/docs).
   Copy the source verbatim — that's the model — then adjust imports and tokens.
2. Replace any hard-coded colors with depot tokens; drop deps the catalog brings
   that we don't want.
3. Keep the exported name aligned with consumer code (don't rename without a
   search-and-replace).
4. Forward `className` so callers can extend with extra utility classes.

## Layouts

Pages are assembled from a small set of layouts from
[devl.dev](https://www.devl.dev):

| Route family                                   | Layout                    | Component(s)                                                       |
| ---------------------------------------------- | ------------------------- | ------------------------------------------------------------------ |
| App shell (`__root.tsx`)                       | `app-shell`               | `app-shell.tsx` + `app-sidebar.tsx` (`<AppShell>`, `<AppSidebar>`) |
| PRD detail (`prds.$id.tsx`)                    | `three-pane`              | `three-pane.tsx` (`<ThreePane>`)                                   |
| Project settings (`projects.$id.settings.tsx`) | `docs-tree`               | `settings-tree.tsx` (`<SettingsTree>`)                             |
| Other pages (lists, docs)                      | `app-shell` single column | `page-shell.tsx` (`<PageShell>`/`<PageTopBar>`/`<PageContent>`)    |

- **`app-shell`** — left sidebar (`<AppSidebar>`: project switcher, contextual
  nav, "new project" link; collapse state persisted in `localStorage` via
  `lib/use-persisted-state.ts`) + main content. No top nav.
- **`three-pane`** — left: tasks/phases; center: PRD content; right: activity +
  reviews (fine, collapsible).
- **`docs-tree`** — tree sidebar (Configuration / Repos / Directives / Doc
  profiles) + main form pane.

When a new page doesn't fit one of these, default to `app-shell` with a single
`<PageContent>` column. Don't invent a new layout.

## Pattern libraries

- **Timelines** — `activity-timeline.tsx` (`<ActivityTimeline>`) is the shared
  pattern, copied from the devl.dev _Timelines_ category. It groups entries
  under day headers, carries a `source` badge (`ai` / `human` / `plugin`),
  renders clickable file links, and expands Bash output. `live-activity-panel.tsx`
  consumes it. Refactor the view-model, not the component, when adding fields.
- **Empty states** — every list that can be empty uses `<EmptyState>` from
  `ui/empty-state.tsx` (devl.dev _Empty States_ category). Pass `message` and an
  optional `action`.
- **Toasts / banners** — inline banners use `prd-notice-banner.tsx`
  (`<PrdNoticeBanner>`). Keep banner styling on the `destructive` / `warning` /
  `info` soft tokens.
- **Tables** — list views (PRD list, doc artifacts) are built from `card` +
  `badge` compositions rather than a generic table primitive.

## Adding a new page

1. Pick the layout from the table above (or default to `app-shell` +
   `<PageContent>`).
2. Compose primitives from `src/web/components/ui/` — don't reach for raw
   `<button>` / `<input>`.
3. Use semantic tokens for every visual property.
4. Empty / loading / error states are mandatory. Use `<EmptyState>` and
   `dot-loader` for those.
5. Add a Playwright test if the page is on a critical path (see
   `tests/e2e/`). Screenshot tests cover the key pages in
   `tests/e2e/visual.spec.ts`.

## Convention

Start from coss-ui for new components: copy-paste the catalog source, then adapt
it to depot tokens and naming. We add inline JSX rather than an npm dependency,
so there is no bundle-size cost beyond the copied markup.
