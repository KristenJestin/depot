import { Effect } from "effect";
import { eq } from "drizzle-orm";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { projectDirectives } from "#/db/schema";
import { Db } from "#/services/database";
import { dbQuery } from "#/shared/db";
import { generateId } from "#/shared/utils";
import { ValidationError } from "#/shared/errors";
import type { DirectiveKind, DirectiveScope, DirectiveRunStatus } from "#/shared/validator";

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

export const runDirective = (
  id: string,
  options: { wsPath: string; timeoutMs?: number } = { wsPath: process.cwd() },
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
    const startedAt = Date.now();
    const execResult = yield* Effect.tryPromise({
      try: async () => {
        const command = resolveShellCommand(directive.instruction);
        const r = await execFileAsync(command.file, command.args, {
          cwd: options.wsPath,
          timeout: options.timeoutMs ?? 60_000,
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

    const status: DirectiveRunStatus = execResult.ok ? "ok" : "fail";
    const stdout = execResult.stdout;
    const stderr = execResult.stderr;
    const exitCode = execResult.code;
    const durationMs = Date.now() - startedAt;
    yield* dbQuery(() =>
      db
        .update(projectDirectives)
        .set({
          lastRunAt: new Date(),
          lastRunStatus: status,
          lastRunOutput: truncate(`STDOUT:\n${stdout}\nSTDERR:\n${stderr}`),
        })
        .where(eq(projectDirectives.id, id)),
    );
    return {
      ok: status === "ok",
      stdout,
      stderr,
      exitCode,
      durationMs,
      directive,
    };
  });

export type DirectiveRunResult = Effect.Effect.Success<ReturnType<typeof runDirective>>;

export const runScopeBlocking = (
  projectId: string,
  scope: DirectiveScope,
  options: { wsPath: string },
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
    }> = [];
    let ok = true;
    let failingDirectiveId: string | undefined;
    for (const directive of blocking) {
      const result = yield* runDirective(directive.id, { wsPath: options.wsPath });
      results.push({
        directiveId: directive.id,
        title: directive.title,
        ok: result.ok,
        durationMs: result.durationMs,
        stdout: result.stdout,
        stderr: result.stderr,
      });
      if (!result.ok) {
        ok = false;
        failingDirectiveId = directive.id;
        break;
      }
    }
    return { ok, failingDirectiveId, results };
  });
