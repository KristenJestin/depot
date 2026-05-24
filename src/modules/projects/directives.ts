import { Effect } from "effect";
import { eq } from "drizzle-orm";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { projectDirectives } from "#/db/schema";
import { Db } from "#/services/database";
import { dbQuery } from "#/shared/db";
import { generateId } from "#/shared/utils";
import { ValidationError } from "#/shared/errors";
import type {
  ActivitySource,
  DirectiveKind,
  DirectiveScope,
  DirectiveRunStatus,
} from "#/shared/validator";
import { resolveProjectRepos, type ResolvedRepo } from "#/modules/projects/repos";
import { hasUncommittedChanges } from "#/lib/git";
import { logActivity } from "#/modules/activity/domain";
import { getPrd } from "#/modules/prds/domain";
import { resolvePrdRepos } from "#/modules/prds/repos";
import { PrdNotFoundError } from "#/shared/errors";

const execFileAsync = promisify(execFile);

const DANGEROUS_PATTERNS = [
  /\brm\s+-rf\b/,
  /\bgit\s+push\s+--force\b/,
  /\bsudo\b/,
  /\bcurl\b.*\|\s*sh\b/,
  /\bcurl\b.*\|\s*bash\b/,
];

const MAX_OUTPUT_BYTES = 8 * 1024;

const truncate = (s: string) =>
  Buffer.byteLength(s, "utf-8") <= MAX_OUTPUT_BYTES
    ? s
    : Buffer.from(s, "utf-8").slice(0, MAX_OUTPUT_BYTES).toString("utf-8") + "\n...[truncated]";

const resolveShellCommand = (instruction: string) =>
  process.platform === "win32"
    ? { file: "cmd.exe", args: ["/d", "/s", "/c", instruction] }
    : { file: "sh", args: ["-c", instruction] };

const assertSafeInstruction = (kind: DirectiveKind, instruction: string) => {
  if (kind !== "command") return;
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(instruction)) {
      throw new Error(
        `Refusing to store directive: instruction matches dangerous pattern ${pattern.toString()}.`,
      );
    }
  }
};

export const createDirective = (input: {
  projectId: string;
  scope: DirectiveScope;
  title: string;
  instruction: string;
  kind: DirectiveKind;
  blocking?: boolean;
  position?: number;
  repoTarget?: string;
}) =>
  Effect.gen(function* () {
    try {
      assertSafeInstruction(input.kind, input.instruction);
    } catch (e) {
      return yield* Effect.fail(
        new ValidationError({ reason: e instanceof Error ? e.message : String(e) }),
      );
    }
    const db = yield* Db;
    const existing = yield* dbQuery(() =>
      db.query.projectDirectives.findMany({
        where: { projectId: input.projectId, scope: input.scope },
      }),
    );
    const position = input.position ?? existing.length;
    const rows = yield* dbQuery(() =>
      db
        .insert(projectDirectives)
        .values({
          id: generateId(),
          projectId: input.projectId,
          scope: input.scope,
          title: input.title,
          instruction: input.instruction,
          kind: input.kind,
          repoTarget: input.repoTarget ?? "auto",
          blocking: input.blocking ?? true,
          position,
          enabled: true,
        })
        .returning(),
    );
    return rows[0]!;
  });

export const updateDirective = (
  id: string,
  patch: {
    title?: string;
    instruction?: string;
    kind?: DirectiveKind;
    blocking?: boolean;
    position?: number;
    enabled?: boolean;
    repoTarget?: string;
  },
) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const existing = yield* dbQuery(() => db.query.projectDirectives.findFirst({ where: { id } }));
    if (!existing) {
      return yield* Effect.fail(new ValidationError({ reason: `Directive not found: ${id}` }));
    }
    if (patch.instruction !== undefined || patch.kind !== undefined) {
      try {
        assertSafeInstruction(
          patch.kind ?? existing.kind,
          patch.instruction ?? existing.instruction,
        );
      } catch (e) {
        return yield* Effect.fail(
          new ValidationError({ reason: e instanceof Error ? e.message : String(e) }),
        );
      }
    }
    const rows = yield* dbQuery(() =>
      db
        .update(projectDirectives)
        .set({
          title: patch.title ?? existing.title,
          instruction: patch.instruction ?? existing.instruction,
          kind: patch.kind ?? existing.kind,
          repoTarget: patch.repoTarget ?? existing.repoTarget,
          blocking: patch.blocking ?? existing.blocking,
          position: patch.position ?? existing.position,
          enabled: patch.enabled ?? existing.enabled,
        })
        .where(eq(projectDirectives.id, id))
        .returning(),
    );
    return rows[0]!;
  });

export const removeDirective = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    yield* dbQuery(() => db.delete(projectDirectives).where(eq(projectDirectives.id, id)));
    return id;
  });

export const getDirective = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    return yield* dbQuery(() => db.query.projectDirectives.findFirst({ where: { id } }));
  });

export const listDirectives = (
  projectId: string,
  options: { scope?: DirectiveScope; enabledOnly?: boolean } = {},
) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const where: Record<string, unknown> = { projectId };
    if (options.scope) where.scope = options.scope;
    if (options.enabledOnly) where.enabled = true;
    return yield* dbQuery(() =>
      db.query.projectDirectives.findMany({
        where,
        orderBy: { position: "asc" },
      }),
    );
  });

export const reorderDirectives = (projectId: string, scope: DirectiveScope, orderedIds: string[]) =>
  Effect.gen(function* () {
    const db = yield* Db;
    for (let i = 0; i < orderedIds.length; i++) {
      const id = orderedIds[i]!;
      yield* dbQuery(() =>
        db.update(projectDirectives).set({ position: i }).where(eq(projectDirectives.id, id)),
      );
    }
    return { projectId, scope, count: orderedIds.length };
  });

const execInCwd = (instruction: string, cwd: string, timeoutMs: number) =>
  Effect.tryPromise({
    try: async () => {
      const command = resolveShellCommand(instruction);
      const r = await execFileAsync(command.file, command.args, {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 4 * MAX_OUTPUT_BYTES,
      });
      return { ok: true as const, stdout: r.stdout, stderr: r.stderr, code: 0 };
    },
    catch: (e) => {
      const err = e as { code?: number; stdout?: string; stderr?: string; message?: string };
      return {
        ok: false as const,
        stdout: err.stdout ?? "",
        stderr: err.stderr ?? err.message ?? String(e),
        code: typeof err.code === "number" ? err.code : 1,
      };
    },
  }).pipe(
    Effect.catchAll((failed) =>
      Effect.succeed({
        ok: false as const,
        stdout: failed.stdout,
        stderr: failed.stderr,
        code: failed.code,
      }),
    ),
  );

export type RepoRunResult = {
  repoName: string;
  repoPath: string;
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
};

/**
 * Why a particular set of repos was chosen for a directive run. Stored on the
 * `directive_run` activity log entry so multi-repo selections are never
 * silent.
 *
 * - `single-repo`        — only one repo is registered (or the implicit repo).
 * - `auto-dirty`         — `auto` matched the listed repos because they had
 *                          uncommitted changes (`consideredRepos` is the full
 *                          candidate set).
 * - `auto-no-dirty`      — `auto` matched no repo (no-op).
 * - `all`                — `all` ran on every registered repo.
 * - `workspace`          — `workspace` ran on the workspace path itself.
 * - `named`              — explicit `<repo-name>` matched.
 * - `named-missing`      — explicit `<repo-name>` did not match any repo.
 */
export type RepoSelectionReason =
  | "single-repo"
  | "auto-dirty"
  | "auto-no-dirty"
  | "all"
  | "workspace"
  | "named"
  | "named-missing";

export type RepoSelection = {
  reason: RepoSelectionReason;
  repos: Array<{ name: string; path: string }>;
  /** All candidates considered when the reason is `auto-*` (multi-repo only). */
  consideredRepos?: Array<{ name: string; path: string }>;
};

const toSelectionRepo = (r: ResolvedRepo) => ({ name: r.name, path: r.path });

/**
 * Resolve the repos a `kind: command` directive should run in, honouring its
 * `repoTarget`. A mono-repo project always resolves to the single implicit
 * repo so `auto`/`all`/`workspace` collapse to current behaviour.
 *
 * Returns both the selected repos and a `selection` value that explains why
 * — so callers (CLI, activity log) can surface the choice.
 */
const resolveDirectiveRepos = (
  repoTarget: string,
  projectId: string,
  wsPath: string,
): Effect.Effect<{ targets: ResolvedRepo[]; selection: RepoSelection }, never, Db> =>
  Effect.gen(function* () {
    const repos = yield* resolveProjectRepos(projectId, wsPath).pipe(
      Effect.catchAll(() => Effect.succeed([] as ResolvedRepo[])),
    );
    const allRepos =
      repos.length > 0
        ? repos
        : [
            {
              id: null,
              name: "(default)",
              path: wsPath,
              isPrimary: true,
              baseBranch: "main",
              implicit: true,
            } satisfies ResolvedRepo,
          ];

    if (repoTarget === "workspace") {
      const workspaceRepo: ResolvedRepo = {
        id: null,
        name: "workspace",
        path: wsPath,
        isPrimary: true,
        baseBranch: "main",
        implicit: true,
      };
      return {
        targets: [workspaceRepo],
        selection: { reason: "workspace", repos: [toSelectionRepo(workspaceRepo)] },
      };
    }
    if (repoTarget === "all") {
      return {
        targets: allRepos,
        selection: { reason: "all", repos: allRepos.map(toSelectionRepo) },
      };
    }
    if (repoTarget === "auto") {
      if (allRepos.length === 1) {
        return {
          targets: allRepos,
          selection: { reason: "single-repo", repos: allRepos.map(toSelectionRepo) },
        };
      }
      const modified: ResolvedRepo[] = [];
      for (const repo of allRepos) {
        const dirty = yield* hasUncommittedChanges(repo.path);
        if (dirty) modified.push(repo);
      }
      return {
        targets: modified,
        selection: {
          reason: modified.length > 0 ? "auto-dirty" : "auto-no-dirty",
          repos: modified.map(toSelectionRepo),
          consideredRepos: allRepos.map(toSelectionRepo),
        },
      };
    }
    const named = allRepos.find((r) => r.name === repoTarget);
    return named
      ? {
          targets: [named],
          selection: { reason: "named", repos: [toSelectionRepo(named)] },
        }
      : {
          targets: [],
          selection: { reason: "named-missing", repos: [] },
        };
  });

export const runDirective = (
  id: string,
  options: {
    wsPath: string;
    timeoutMs?: number;
    source?: ActivitySource;
    /**
     * Attribute the resulting `directive_run` activity log entry to a PRD
     * revision (PRD 0007 T2). Without it, the entry stays project-scoped, as
     * before. With it, the entry's `prd_revision_id` column is populated so
     * the PRD timeline picks the run up.
     */
    prdRevisionId?: string;
  } = { wsPath: process.cwd() },
) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const directive = yield* dbQuery(() => db.query.projectDirectives.findFirst({ where: { id } }));
    if (!directive) {
      return yield* Effect.fail(new ValidationError({ reason: `Directive not found: ${id}` }));
    }
    if (directive.kind !== "command") {
      return yield* Effect.fail(
        new ValidationError({
          reason: `Directive ${id} is not a command (kind=${directive.kind})`,
        }),
      );
    }
    const timeoutMs = options.timeoutMs ?? 60_000;
    const startedAt = Date.now();

    const { targets, selection } = yield* resolveDirectiveRepos(
      directive.repoTarget,
      directive.projectId,
      options.wsPath,
    );

    const repoResults: RepoRunResult[] = [];
    let aggregateOk = true;
    let noOp = false;

    if (targets.length === 0) {
      // `auto` with no modified repo detected — a no-op, not a failure.
      noOp = true;
    }

    for (const repo of targets) {
      const execResult = yield* execInCwd(directive.instruction, repo.path, timeoutMs);
      repoResults.push({
        repoName: repo.name,
        repoPath: repo.path,
        ok: execResult.ok,
        stdout: execResult.stdout,
        stderr: execResult.stderr,
        exitCode: execResult.code,
      });
      if (!execResult.ok) aggregateOk = false;
    }

    const status: DirectiveRunStatus = aggregateOk ? "ok" : "fail";
    const stdout = repoResults
      .map((r) => (targets.length > 1 ? `[${r.repoName}]\n${r.stdout}` : r.stdout))
      .join("\n");
    const stderr = repoResults
      .map((r) => (targets.length > 1 ? `[${r.repoName}]\n${r.stderr}` : r.stderr))
      .join("\n");
    const firstFailure = repoResults.find((r) => !r.ok);
    const exitCode = firstFailure ? firstFailure.exitCode : 0;
    const durationMs = Date.now() - startedAt;

    yield* dbQuery(() =>
      db
        .update(projectDirectives)
        .set({
          lastRunAt: new Date(),
          lastRunStatus: status,
          lastRunOutput: truncate(
            noOp
              ? "STDOUT:\n(no modified repo detected — no-op)\nSTDERR:\n"
              : `STDOUT:\n${stdout}\nSTDERR:\n${stderr}`,
          ),
        })
        .where(eq(projectDirectives.id, id)),
    );

    // Record the run in the activity log with full repo selection traceability
    // (PRD 0007 T1). Single source of truth — CLI and web wrappers no longer
    // emit their own duplicate entry.
    yield* logActivity({
      projectId: directive.projectId,
      prdRevisionId: options.prdRevisionId,
      eventType: "directive_run",
      payload: {
        directiveId: id,
        status,
        durationMs,
        repoTarget: directive.repoTarget,
        selection,
      },
      source: options.source ?? "ai",
    }).pipe(Effect.catchAll(() => Effect.void));

    return {
      ok: aggregateOk,
      stdout,
      stderr,
      exitCode,
      durationMs,
      directive,
      noOp,
      repoResults,
      selection,
    };
  });

export type DirectiveRunResult = Effect.Effect.Success<ReturnType<typeof runDirective>>;

/**
 * Render a single human-readable trace line for a directive run selection.
 * Returns `null` for mono-repo / single-repo selections so callers can stay
 * terse in the common case. Used by the CLI directive runners and the
 * pre-X-check wrappers so `repoTarget=auto` is never silent in multi-repo
 * projects (PRD 0007 T1).
 */
export const formatSelectionTrace = (selection: RepoSelection): string | null => {
  switch (selection.reason) {
    case "single-repo":
      return null;
    case "auto-dirty": {
      const considered = selection.consideredRepos?.length ?? selection.repos.length;
      const names = selection.repos.map((r) => r.name).join(", ");
      return `repos: ${names} (auto: ${selection.repos.length}/${considered} with uncommitted changes)`;
    }
    case "auto-no-dirty": {
      const considered = selection.consideredRepos?.length ?? 0;
      return `repos: (none — auto: 0/${considered} with uncommitted changes)`;
    }
    case "all": {
      const names = selection.repos.map((r) => r.name).join(", ");
      return `repos: ${names} (all)`;
    }
    case "workspace":
      return `repos: workspace (workspace target)`;
    case "named": {
      const names = selection.repos.map((r) => r.name).join(", ");
      return `repos: ${names} (named target)`;
    }
    case "named-missing":
      return `repos: (none — named target did not match any registered repo)`;
  }
};

export type RunScopeBlockingResult = Effect.Effect.Success<ReturnType<typeof runScopeBlocking>>;

export const runScopeBlocking = (
  projectId: string,
  scope: DirectiveScope,
  options: {
    wsPath: string;
    source?: ActivitySource;
    /**
     * When provided, every `directive_run` log entry emitted by this scope is
     * attributed to the PRD revision (PRD 0007 T2). Wrappers like
     * `prd pre-ship-check` / `pre-review-check` use this so per-PRD activity
     * timelines include their pre-check runs.
     */
    prdRevisionId?: string;
  },
) =>
  Effect.gen(function* () {
    const directives = yield* listDirectives(projectId, { scope, enabledOnly: true });
    const blocking = directives.filter((d) => d.blocking);
    const results: Array<{
      directiveId: string;
      title: string;
      ok: boolean;
      durationMs: number;
      stdout: string;
      stderr: string;
      repoTarget: string;
      noOp: boolean;
      repoResults: RepoRunResult[];
      selection: RepoSelection;
    }> = [];
    let ok = true;
    let failingDirectiveId: string | undefined;
    for (const directive of blocking) {
      // Rule directives are advisory text — only command directives execute.
      if (directive.kind !== "command") continue;
      const result = yield* runDirective(directive.id, {
        wsPath: options.wsPath,
        source: options.source,
        prdRevisionId: options.prdRevisionId,
      });
      results.push({
        directiveId: directive.id,
        title: directive.title,
        ok: result.ok,
        durationMs: result.durationMs,
        stdout: result.stdout,
        stderr: result.stderr,
        repoTarget: directive.repoTarget,
        noOp: result.noOp,
        repoResults: result.repoResults,
        selection: result.selection,
      });
      if (!result.ok) {
        ok = false;
        failingDirectiveId = directive.id;
        break;
      }
    }
    return { ok, failingDirectiveId, results };
  });

export type PerRepoScopeOutcome = {
  repoName: string;
  repoPath: string;
  implicit: boolean;
  ok: boolean;
  failingDirectiveId?: string;
  results: RunScopeBlockingResult["results"];
};

/**
 * Run a blocking scope (`pre-ship` / `pre-review`) for every repo the PRD
 * targets (PRD 0007 T3). Iteration order matches `resolvePrdRepos`:
 *
 * - PRD with N `prd_repo` entries → run in those N repos.
 * - PRD with no `prd_repo` → fallback to every `project_repo`, or the
 *   implicit repo when the project is mono-repo.
 *
 * For each repo we call `runScopeBlocking` with `wsPath = repo.path` so
 * `repoTarget: workspace` directives execute in that repo, and propagate
 * `prdRevisionId` so each `directive_run` log line is attributed to the PRD.
 * A failing repo does not short-circuit the next repo — we want pre-checks to
 * surface every broken repo, not just the first one. Within a repo,
 * `runScopeBlocking` still stops at the first failing directive (existing
 * behaviour).
 */
export const runScopeBlockingForPrd = (
  prdRevisionId: string,
  scope: DirectiveScope,
  options: { wsPath: string; source?: ActivitySource },
) =>
  Effect.gen(function* () {
    const prd = yield* getPrd(prdRevisionId);
    if (!prd) {
      return yield* Effect.fail(new PrdNotFoundError({ id: prdRevisionId }));
    }
    const repos = yield* resolvePrdRepos(prdRevisionId, prd.projectId, options.wsPath);
    const perRepo: PerRepoScopeOutcome[] = [];
    let aggregateOk = true;
    for (const repo of repos) {
      const result = yield* runScopeBlocking(prd.projectId, scope, {
        wsPath: repo.path,
        source: options.source,
        prdRevisionId,
      });
      perRepo.push({
        repoName: repo.name,
        repoPath: repo.path,
        implicit: repo.implicit,
        ok: result.ok,
        failingDirectiveId: result.failingDirectiveId,
        results: result.results,
      });
      if (!result.ok) aggregateOk = false;
    }
    return { ok: aggregateOk, perRepo };
  });
