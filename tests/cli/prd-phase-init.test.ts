/**
 * PRD 0017 / T4b — `depot prd phase init` CLI subcommand.
 *
 * The command seeds `currentPhase` on a legacy PRD that was activated before
 * the auto-seed/auto-derive shipped. Covers:
 *
 *   - --user-confirmed mandatory (PRD 0012 alignment).
 *   - default derive (no --phase) from the PRD's tasks.
 *   - explicit --phase value.
 *   - refusal when currentPhase is already non-null without --force.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vite-plus/test";
import { Effect } from "effect";
import { eq } from "drizzle-orm";
import { createTestDb } from "../helpers/db";
import type { Database } from "#/db/client";
import { prdRevisions } from "#/db/schema";
import { Db } from "#/services/database";
import {
  activatePrd,
  addWorkspace,
  createPrd,
  createProject,
  listActivity,
  markPrdReady,
} from "#/lib/workflow";
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

async function withoutBypass(fn: () => Promise<void>): Promise<void> {
  const prev = process.env["DEPOT_BYPASS_USER_CONFIRMATION"];
  delete process.env["DEPOT_BYPASS_USER_CONFIRMATION"];
  try {
    await fn();
  } finally {
    if (prev !== undefined) process.env["DEPOT_BYPASS_USER_CONFIRMATION"] = prev;
  }
}

function expectProcessExit() {
  return vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
    throw new Error(`process.exit:${code ?? 0}`);
  }) as never);
}

async function insertRawTask(
  db: Database,
  prdRevisionId: string,
  phaseNumber: number | null,
  status: "pending" | "done" = "pending",
): Promise<void> {
  const { tasks: tasksTable } = await import("#/db/schema");
  await db.insert(tasksTable).values({
    id: `task-${Math.random().toString(36).slice(2, 10)}`,
    prdRevisionId,
    position: 1,
    title: `Task ph=${phaseNumber ?? "null"}`,
    description: "desc",
    doneCriteria: "done",
    effort: "s",
    phaseNumber,
    status,
    dependsOn: "[]",
    blockedReason: null,
    skipReason: null,
    startedAt: null,
    completedAt: null,
  });
}

const VALID_QUOTE = "please initialise the phase";

describe("depot prd phase init (PRD 0017 / T4b)", () => {
  let db: Database;
  let projectId: string;
  let workspaceId: string;

  beforeEach(async () => {
    vi.resetAllMocks();
    setJsonMode(false);
    ({ db } = createTestDb());
    currentTestDb = db;

    const project = await createProject(db, { name: "phase-init-project" });
    projectId = project.id;

    const workspace = await addWorkspace(db, {
      projectId,
      path: "/workspace/phase-init-project",
    });
    workspaceId = workspace.id;

    resolveCurrentWorkspace.mockResolvedValue({ db, ws: workspace });
    getDb.mockResolvedValue(db);
  });

  afterEach(() => {
    setJsonMode(false);
  });

  async function setupLegacyActivePrd(): Promise<string> {
    const prd = await createPrd(db, { projectId, title: "Legacy PRD" });
    await markPrdReady(db, prd.id);
    await activatePrd(db, prd.id, workspaceId);
    // The activate auto-derive (T4a) would already seed currentPhase from the
    // tasks that exist at that moment. To simulate the legacy state — PRD
    // activated, tasks attached *afterwards* — we attach tasks here and force
    // currentPhase back to NULL.
    await db.update(prdRevisions).set({ currentPhase: null }).where(eq(prdRevisions.id, prd.id));
    return prd.id;
  }

  it("(a) errors when --user-confirmed is absent and bypass env is unset", async () => {
    const id = await setupLegacyActivePrd();
    await insertRawTask(db, id, 1, "pending");

    const { prdCommand } = await import("#/cli/commands/prds");
    const phaseCmd = await getSubCommand(prdCommand, "phase");
    const initCmd = await getSubCommand(phaseCmd, "init");
    const exit = expectProcessExit();

    const stderr = await captureConsoleError(async () => {
      await withoutBypass(async () => {
        await expect(initCmd.run({ args: { prdId: id } })).rejects.toThrow("process.exit:1");
      });
    });
    expect(stderr).toMatch(/depot prd phase init/);
    expect(stderr).toMatch(/--user-confirmed/);

    const after = await db.query.prdRevisions.findFirst({ where: { id } });
    expect(after!.currentPhase).toBeNull();
    exit.mockRestore();
  });

  it("(b) rejects empty / whitespace --user-confirmed but accepts a short non-empty quote", async () => {
    const { prdCommand } = await import("#/cli/commands/prds");
    const phaseCmd = await getSubCommand(prdCommand, "phase");
    const initCmd = await getSubCommand(phaseCmd, "init");

    const id = await setupLegacyActivePrd();
    await insertRawTask(db, id, 1, "pending");

    for (const empty of ["", "   "]) {
      const exit = expectProcessExit();
      const stderr = await captureConsoleError(async () => {
        await withoutBypass(async () => {
          await expect(initCmd.run({ args: { prdId: id, userConfirmed: empty } })).rejects.toThrow(
            "process.exit:1",
          );
        });
      });
      expect(stderr).toMatch(/empty|rejected/i);
      expect(stderr).toMatch(/--user-confirmed/);

      const after = await db.query.prdRevisions.findFirst({ where: { id } });
      expect(after!.currentPhase).toBeNull();
      exit.mockRestore();
    }

    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    await withoutBypass(async () => {
      await initCmd.run({ args: { prdId: id, userConfirmed: "go" } });
    });
    out.mockRestore();

    const shortAfter = await db.query.prdRevisions.findFirst({ where: { id } });
    expect(shortAfter!.currentPhase).toBe(1);

    const events = await listActivity(db, { projectId });
    const event = events
      .filter((e) => e.prdRevisionId === id && e.eventType === "prd_phase_initialized")
      .at(-1);
    expect(event).toBeDefined();
    const payload = JSON.parse(event!.payload) as Record<string, unknown>;
    expect(payload["userConfirmation"]).toBe("go");
  });

  it("derives currentPhase from pending tasks when --phase is omitted", async () => {
    const id = await setupLegacyActivePrd();
    await insertRawTask(db, id, 1, "done");
    await insertRawTask(db, id, 2, "pending");
    await insertRawTask(db, id, 3, "pending");

    const { prdCommand } = await import("#/cli/commands/prds");
    const phaseCmd = await getSubCommand(prdCommand, "phase");
    const initCmd = await getSubCommand(phaseCmd, "init");

    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    await initCmd.run({ args: { prdId: id, userConfirmed: VALID_QUOTE } });
    out.mockRestore();

    const after = await db.query.prdRevisions.findFirst({ where: { id } });
    expect(after!.currentPhase).toBe(2);

    const events = await listActivity(db, { projectId });
    const event = events.find((e) => e.eventType === "prd_phase_initialized");
    expect(event).toBeDefined();
    const payload = JSON.parse(event!.payload) as Record<string, unknown>;
    expect(payload["toPhase"]).toBe(2);
    expect(payload["fromPhase"]).toBeNull();
    expect(payload["derivedFromTasks"]).toBe(true);
    expect(payload["userConfirmation"]).toBe(VALID_QUOTE);
  });

  it("sets currentPhase to the explicit --phase value", async () => {
    const id = await setupLegacyActivePrd();
    await insertRawTask(db, id, 1, "pending");
    await insertRawTask(db, id, 2, "pending");

    const { prdCommand } = await import("#/cli/commands/prds");
    const phaseCmd = await getSubCommand(prdCommand, "phase");
    const initCmd = await getSubCommand(phaseCmd, "init");

    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    await initCmd.run({ args: { prdId: id, phase: 2, userConfirmed: VALID_QUOTE } });
    out.mockRestore();

    const after = await db.query.prdRevisions.findFirst({ where: { id } });
    expect(after!.currentPhase).toBe(2);

    const events = await listActivity(db, { projectId });
    const event = events.find((e) => e.eventType === "prd_phase_initialized");
    expect(event).toBeDefined();
    const payload = JSON.parse(event!.payload) as Record<string, unknown>;
    expect(payload["toPhase"]).toBe(2);
    expect(payload["derivedFromTasks"]).toBe(false);
  });

  it("refuses to overwrite an already-set currentPhase without --force", async () => {
    const id = await setupLegacyActivePrd();
    await insertRawTask(db, id, 1, "pending");
    await db.update(prdRevisions).set({ currentPhase: 1 }).where(eq(prdRevisions.id, id));

    const { prdCommand } = await import("#/cli/commands/prds");
    const phaseCmd = await getSubCommand(prdCommand, "phase");
    const initCmd = await getSubCommand(phaseCmd, "init");
    const exit = expectProcessExit();

    const stderr = await captureConsoleError(async () => {
      await expect(
        initCmd.run({ args: { prdId: id, phase: 1, userConfirmed: VALID_QUOTE } }),
      ).rejects.toThrow("process.exit:1");
    });
    expect(stderr).toMatch(/already has currentPhase/);

    const after = await db.query.prdRevisions.findFirst({ where: { id } });
    expect(after!.currentPhase).toBe(1);
    exit.mockRestore();
  });
});
