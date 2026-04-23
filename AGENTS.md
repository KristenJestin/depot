# AGENTS.md

## Project Overview

`depot` is a Bun + TypeScript CLI for AI agent task and PRD management.

- Runtime: Bun
- Language: TypeScript with `strict` mode
- CLI entrypoint: `src/cli/index.ts`
- Main product context lives in `docs/index.md` and `docs/concepts/index.md`
- Current and planned work is tracked in `docs/roadmap.md`
- Feature specs (PRDs) live in `.prds/` as numbered Markdown files
- Distribution target: npm global install (`bun add -g depot`); Bun is required on the user's machine — no standalone binary, no self-contained bundle

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

## Testing And Validation

- Add or update tests by default when changing code.
- During implementation, run targeted tests when they help you iterate faster.
- Before finishing a code change, run `bun run check` and `bun run build`.
- If a change is documentation-only, heavy validation can be skipped.
- Do not finish with failing tests, lint errors, type errors, or build errors unless the user explicitly accepts that state.
- Do not modify `tests/lib/workflow.test.ts`; it is a fixed contract and must not be changed.

## Database And Migrations

- `src/db/schema.ts` is the source of truth for the database schema.
- Generate migrations with `bun run db:generate`.
- Do not hand-edit generated migration files unless the user explicitly asks for it.
- Use the existing Drizzle configuration in `drizzle.config.ts`.

## Agent Workflow

- Start by reading the relevant code and only then make changes.
- Use `docs/index.md`, `docs/concepts/index.md`, and `docs/roadmap.md` as supporting context, not as a replacement for reading the code.
- Prefer the smallest correct fix or implementation.
- Preserve existing behavior unless the task requires changing it.
- If behavior and docs disagree, follow the current codebase and update docs only when appropriate.
- When changing CLI behavior, verify the user-facing command path and output.

## Git And Commits

- Do not create a commit unless the user explicitly asks for a commit for the current changes.
- A prior commit approval does not carry forward to later changes.
- If the user asks for a commit, only commit the changes currently requested and completed.
- Use Angular-style commit messages.
- Allowed commit types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`.
- Do not invent PR instructions in this file unless the user asks for them later.
