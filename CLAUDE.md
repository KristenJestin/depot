# AGENTS.md

## Project Overview

`depot` is a Node.js + TypeScript CLI for AI agent task and PRD management.

- Runtime: Node.js ≥ 25 (uses `node:sqlite`); Bun is used for tooling only (tests, build, package management)
- Language: TypeScript with `strict` mode
- CLI entrypoint: `src/cli/index.ts`
- Main product context lives in `docs/index.md` and `docs/concepts/index.md`
- Current and planned work is tracked in `docs/roadmap.md`
- Feature specs (PRDs) live under `.scratch/<feature-slug>/PRD.md` (one feature per directory; implementation issues in `issues/`). See `docs/agents/issue-tracker.md`.
- Distribution target: npm global install (`npm install -g @netsirk/depot`); Node.js ≥ 25 is required on the user's machine — no standalone binary, no self-contained bundle

Use `docs/index.md` and `docs/concepts/index.md` for product intent and domain language. Use `docs/roadmap.md` to understand implementation direction, but treat the current codebase as the source of truth for behavior.

## Setup Commands

- Install dependencies: `bun install`
- Run the CLI locally: `bun run depot -- --help`
- Run tests: `bun run test`
- Run typecheck: `bun run typecheck`
- Run lint: `bun run lint`
- Run format check: `bun run fmt:check`
- Fix formatting: `bun run fmt`
- Run full checks: `bun run check`
- Build: `bun run build`

## Code Style

- Follow the existing repository style instead of introducing a new one.
- TypeScript is `strict`; keep types explicit when inference is not clear.
- Formatting is enforced by `oxfmt`.
- Linting is enforced by `oxlint`.
- Use double quotes and semicolons.
- Prefer small, direct changes over broad refactors.
- Reuse the existing `#/` import alias for source imports when appropriate.
- Keep CLI behavior deterministic and terminal-friendly.
- `src/types/text.d.ts` declares `*.md` module types required for `import ... with { type: "text" }` in `contexts.ts`. Do not delete it.
- Do not use numbered step comments (`// 1.`, `// 2. Parse JSON`, etc.). Comments document intent or the _why_, not procedural steps. Omit a comment entirely when the code is self-explanatory.

## Testing And Validation

- Add or update tests by default when changing code.
- During implementation, run targeted tests when they help you iterate faster.
- Before finishing a code change, run `bun run check` and `bun run build`.
- If a change is documentation-only, heavy validation can be skipped.
- Do not finish with failing tests, lint errors, type errors, or build errors unless the user explicitly accepts that state.

## Database And Migrations

- `src/db/schema.ts` is the source of truth for the database schema.
- Generate migrations with `bun run db:generate`.
- Do not hand-edit generated migration files unless the user explicitly asks for it.
- Use the existing Drizzle configuration in `drizzle.config.ts`.

### Dev DB isolation — mandatory

The project root contains a `.env` file that sets `DEPOT_DB_PATH=.depot-dev/depot.db`
(the legacy `DB_PATH` var is still honoured for one release but the CLI prints a deprecation
warning on stderr).
`bun run depot --` builds the CLI (`vp pack`) then runs the dist via `node --env-file-if-exists=.env`,
so `.env` is automatically picked up. Vitest also loads `.env` automatically.

On every invocation the CLI prints a one-line banner on stderr identifying the target DB:
`[depot] DB: dev|custom|prod (<path>)`. The `prod` banner is highlighted (yellow on a TTY,
prefixed with `WARNING: ` otherwise) to make accidental writes against `~/.depot/depot.db`
obvious. Set `DEPOT_QUIET=1` or pass `--json` to suppress the banner.

- **Always use `bun run depot --` for local CLI testing**, never the global `depot` binary.
  `bun run depot --` writes to `.depot-dev/depot.db`, not `~/.depot/depot.db`.
- **Never run `bun run db:migrate` or apply migrations manually against `~/.depot/depot.db`.**
  If you need to test a migration, set `DEPOT_DB_PATH` to a throwaway path and verify there first.
- When you change `src/db/schema.ts`, regenerate migrations with `bun run db:generate`, verify
  the generated SQL is additive (ALTER TABLE ADD COLUMN, CREATE TABLE, CREATE INDEX).
  If the schema change requires dropping or renaming tables, write a data-preserving migration:
  RENAME old table → copy data → create new table → DROP old table. Never DROP before INSERT.

## Agent Workflow

- Start by reading the relevant code and only then make changes.
- Use `docs/index.md`, `docs/concepts/index.md`, and `docs/roadmap.md` as supporting context, not as a replacement for reading the code.
- Prefer the smallest correct fix or implementation.
- Preserve existing behavior unless the task requires changing it.
- If behavior and docs disagree, follow the current codebase and update docs only when appropriate.
- When changing CLI behavior, verify the user-facing command path and output.

<!-- intent-skills:start -->

## Skill Loading

Before substantial work:

- Skill check: run `bunx @tanstack/intent@latest list`, or use skills already listed in context.
- Skill guidance: if one local skill clearly matches the task, run `bunx @tanstack/intent@latest load <package>#<skill>` and follow the returned `SKILL.md`.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.
<!-- intent-skills:end -->

## Git And Commits

- Do not create a commit unless the user explicitly asks for a commit for the current changes.
- A prior commit approval does not carry forward to later changes.
- If the user asks for a commit, only commit the changes currently requested and completed.
- Use Angular-style commit messages.
- Allowed commit types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`.
- Do not invent PR instructions in this file unless the user asks for them later.
