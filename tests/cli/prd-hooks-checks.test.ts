/**
 * PRD 0013 / T5 — CLI wrappers for the 4 new dev-flow hooks.
 *
 * Each wrapper (`prd pre-coder-check`, `prd post-auditor-check`,
 * `prd pre-handoff-check`, `prd pre-phase-advance-check`) is the per-scope
 * analogue of the existing `prd pre-review-check` / `prd pre-ship-check`. For
 * each of the 4 wrappers we cover three cases:
 *
 *   (1) no directive of this scope            → exits 0, JSON payload reports
 *                                                an empty result.
 *   (2) one blocking command directive passes → exits 0, JSON payload contains
 *                                                the directive result.
 *   (3) one blocking command directive fails  → exits 1, stderr surfaces the
 *                                                failing command's stderr.
 *
 * Per-directive `directive_run` events written by `runDirective` are verified
 * once per wrapper (case 2) so we are confident the high-level wrapper still
 * propagates `prdRevisionId` through the shared helper.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vite-plus/test";
import { Effect } from "effect";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { createTestDb } from "../helpers/db";
import type { Database } from "#/db/client";
import { Db } from "#/services/database";
import { addWorkspace, createPrd, createProject, listActivity } from "#/lib/workflow";
import { createDirective } from "#/modules/projects/directives";
import { setJsonMode } from "#/shared/logger";

const resolveCurrentWorkspace =
  vi.fn<() => Promise<{ db: Database; ws: unknown; currentRepo?: unknown }>>();
const getDb = vi.fn<() => Promise<Database>>();

let currentTestDb: Database;

vi.mock("#/cli/runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#/cli/runtime")>();
  return {
    ...actual,
    resolveCurrentWorkspace,
    getDb,
    runEffect: <A, E>(effect: Effect.Effect<A, E, Db>) =>
      Effect.runPromise(Effect.provideService(effect, Db, currentTestDb)),
  };
});

type RunnableSubCommand = {
  run: (ctx: { args: Record<string, unknown> }) => Promise<void> | void;
  subCommands?: unknown;
};

async function getSubCommand(command: { subCommands?: unknown }, name: string) {
  const subCommands = await command.subCommands;
  if (!subCommands || typeof subCommands !== "object" || !(name in subCommands)) {
    throw new Error(`Subcommand not found: ${name}`);
  }
  return (subCommands as Record<string, RunnableSubCommand>)[name]!;
}

/**
 * Capture every JSON-success payload emitted on stdout by `output.success`
 * during `fn()`. The wrappers call `output.success(result)` once when
 * `--json` is active; the test forces JSON mode so we can read it back.
 */
async function captureJsonPayloads(fn: () => Promise<void>): Promise<unknown[]> {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown) => {
    if (typeof chunk === "string") chunks.push(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    await fn();
  } finally {
    process.stdout.write = original;
  }
  const payloads: unknown[] = [];
  for (const line of chunks.join("").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as { kind?: string; payload?: unknown };
      if (parsed.kind === "success") payloads.push(parsed.payload);
    } catch {
      // Non-JSON output (text-mode lines or partial chunks) is irrelevant.
    }
  }
  return payloads;
}

async function captureConsoleError(fn: () => Promise<void>): Promise<string> {
  const messages: string[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((message) => {
    messages.push(String(message));
  });
  try {
    await fn();
  } finally {
    spy.mockRestore();
  }
  return messages.join("\n");
}

// Each wrapper is fully specified by (commandName, scope, eventType). Driving
// the 12 tests off this table keeps the suite identical for the four wrappers
// — same shape as `buildCheckCommand` itself.
const WRAPPERS = [
  {
    commandName: "pre-coder-check",
    scope: "pre-coder-spawn",
    eventType: "pre_coder_check",
  },
  {
    commandName: "post-auditor-check",
    scope: "post-auditor-pass",
    eventType: "post_auditor_check",
  },
  {
    commandName: "pre-handoff-check",
    scope: "pre-handoff",
    eventType: "pre_handoff_check",
  },
  {
    commandName: "pre-phase-advance-check",
    scope: "pre-phase-advance",
    eventType: "pre_phase_advance_check",
  },
] as const;

describe("PRD hooks-check wrappers (PRD 0013 / T5)", () => {
  let db: Database;
  let projectId: string;
  let workspacePath: string;
  const tempDirs: string[] = [];

  beforeEach(async () => {
    vi.resetAllMocks();
    setJsonMode(true);
    ({ db } = createTestDb());
    currentTestDb = db;

    const project = await createProject(db, { name: "hooks-project" });
    projectId = project.id;

    // Real temp dir is required: the wrapper resolves the workspace's implicit
    // repo via `resolvePrdRepos`, which inspects the path on disk.
    workspacePath = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), "depot-hooks-")));
    tempDirs.push(workspacePath);
    const workspace = await addWorkspace(db, { projectId, path: workspacePath });

    resolveCurrentWorkspace.mockResolvedValue({ db, ws: workspace });
    getDb.mockResolvedValue(db);
  });

  afterEach(async () => {
    setJsonMode(false);
    for (const dir of tempDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  for (const { commandName, scope, eventType } of WRAPPERS) {
    describe(`prd ${commandName}`, () => {
      it("(1) exits 0 with an empty payload when no directive matches the scope", async () => {
        const prd = await createPrd(db, { projectId, title: `Empty ${commandName}` });
        const { prdCommand } = await import("#/cli/commands/prds");
        const cmd = await getSubCommand(prdCommand, commandName);

        const prevExit = process.exitCode;
        process.exitCode = 0;
        const payloads = await captureJsonPayloads(async () => {
          await cmd.run({ args: { prdId: prd.id } });
        });
        const observedExit = process.exitCode;
        process.exitCode = prevExit;

        expect(observedExit).toBe(0);
        expect(payloads).toHaveLength(1);
        const payload = payloads[0] as { ok: boolean; perRepo: Array<{ results: unknown[] }> };
        expect(payload.ok).toBe(true);
        // Mono-repo fallback: a single implicit repo with no directive results.
        expect(payload.perRepo).toHaveLength(1);
        expect(payload.perRepo[0]!.results).toEqual([]);

        const events = await listActivity(db, { projectId });
        const check = events.find((e) => e.eventType === eventType);
        expect(check).toBeTruthy();
        expect(check!.prdRevisionId).toBe(prd.id);
      });

      it("(2) exits 0, payload contains the directive result, directive_run is logged with prdRevisionId", async () => {
        const prd = await createPrd(db, { projectId, title: `Passing ${commandName}` });
        await Effect.runPromise(
          Effect.provideService(
            createDirective({
              projectId,
              scope,
              category: "dev",
              kind: "command",
              title: `pass-${scope}`,
              instruction: "echo hooked-ok",
              blocking: true,
            }),
            Db,
            db,
          ),
        );
        const { prdCommand } = await import("#/cli/commands/prds");
        const cmd = await getSubCommand(prdCommand, commandName);

        const prevExit = process.exitCode;
        process.exitCode = 0;
        const payloads = await captureJsonPayloads(async () => {
          await cmd.run({ args: { prdId: prd.id } });
        });
        const observedExit = process.exitCode;
        process.exitCode = prevExit;

        expect(observedExit).toBe(0);
        expect(payloads).toHaveLength(1);
        const payload = payloads[0] as {
          ok: boolean;
          perRepo: Array<{ ok: boolean; results: Array<{ title: string; ok: boolean }> }>;
        };
        expect(payload.ok).toBe(true);
        expect(payload.perRepo).toHaveLength(1);
        expect(payload.perRepo[0]!.ok).toBe(true);
        expect(payload.perRepo[0]!.results).toHaveLength(1);
        expect(payload.perRepo[0]!.results[0]!.title).toBe(`pass-${scope}`);
        expect(payload.perRepo[0]!.results[0]!.ok).toBe(true);

        const events = await listActivity(db, { projectId });
        const directiveRun = events.find((e) => e.eventType === "directive_run");
        expect(directiveRun).toBeTruthy();
        expect(directiveRun!.prdRevisionId).toBe(prd.id);
        const check = events.find((e) => e.eventType === eventType);
        expect(check).toBeTruthy();
        expect(check!.prdRevisionId).toBe(prd.id);
      });

      it("(3) exits non-zero when a blocking directive fails; stderr surfaces the failure", async () => {
        const prd = await createPrd(db, { projectId, title: `Failing ${commandName}` });
        await Effect.runPromise(
          Effect.provideService(
            createDirective({
              projectId,
              scope,
              category: "dev",
              kind: "command",
              title: `fail-${scope}`,
              // Use Node instead of shell separators so the fixture fails the
              // same way through both `sh -c` and Windows `cmd.exe /c`.
              instruction: "node -e \"process.stderr.write('boom-stderr'); process.exit(11)\"",
              blocking: true,
            }),
            Db,
            db,
          ),
        );
        const { prdCommand } = await import("#/cli/commands/prds");
        const cmd = await getSubCommand(prdCommand, commandName);

        const prevExit = process.exitCode;
        process.exitCode = 0;
        let payloads: unknown[] = [];
        const stderr = await captureConsoleError(async () => {
          payloads = await captureJsonPayloads(async () => {
            await cmd.run({ args: { prdId: prd.id } });
          });
        });
        const observedExit = process.exitCode;
        process.exitCode = prevExit;

        expect(observedExit).toBe(1);
        // JSON payload still emits so callers see the structured failure.
        expect(payloads).toHaveLength(1);
        const payload = payloads[0] as {
          ok: boolean;
          perRepo: Array<{
            ok: boolean;
            failingDirectiveId?: string;
            results: Array<{ ok: boolean; stderr: string; title: string }>;
          }>;
        };
        expect(payload.ok).toBe(false);
        expect(payload.perRepo[0]!.ok).toBe(false);
        expect(payload.perRepo[0]!.failingDirectiveId).toBeTruthy();
        const failing = payload.perRepo[0]!.results.find((r) => !r.ok);
        expect(failing).toBeTruthy();
        expect(failing!.stderr).toMatch(/boom-stderr/);

        // The high-level activity event captures the failure too. The wrapper
        // does not also echo to console.error in JSON mode (the structured
        // payload is the source of truth), so we don't assert anything on the
        // captured `stderr` console string itself.
        void stderr;
        const events = await listActivity(db, { projectId });
        const check = events.find((e) => e.eventType === eventType);
        expect(check).toBeTruthy();
        const checkPayload = JSON.parse(check!.payload) as { ok: boolean };
        expect(checkPayload.ok).toBe(false);
      });
    });
  }
});
