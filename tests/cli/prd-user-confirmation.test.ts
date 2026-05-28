/**
 * PRD 0012 / T1 — `--user-confirmed` gate on PRD lifecycle CLI commands.
 *
 * For each critical command (`ready`, `activate`, `request-review`, `done`,
 * `phase-advance`, `cancel`, `close`) we cover four cases:
 *
 *   (a) flag absent + bypass env unset   → exits ≠ 0 with a guide message.
 *   (b) flag value ≤ 5 chars             → exits ≠ 0 with a length hint.
 *   (c) flag valid                       → transition runs and the activity
 *                                          log payload carries the literal
 *                                          quote in `userConfirmation`.
 *   (d) bypass env set + flag absent     → transition runs and the activity
 *                                          log payload carries `userConfirmation: null`.
 *
 * The `close` wrapper additionally verifies that a single `--user-confirmed`
 * quote is propagated to the three internal transitions (activate →
 * request-review → done).
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vite-plus/test";
import { Effect } from "effect";
import { eq } from "drizzle-orm";
import { createTestDb } from "../helpers/db";
import type { Database } from "#/db/client";
import { prdRevisions } from "#/db/schema";
import { Db } from "#/services/database";
import {
  addWorkspace,
  activatePrd,
  completeTask,
  createPrd,
  createProject,
  createTask,
  listActivity,
  markPrdReady,
  requestReviewPrd,
  startTask,
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

/**
 * Run `fn` with `DEPOT_BYPASS_USER_CONFIRMATION` unset, then restore the
 * previous value. The test setup file sets the bypass globally so every
 * pre-existing test stays green; cases (a) and (b) need it temporarily off.
 */
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

async function findLatestPayload(
  db: Database,
  prdRevisionId: string,
  eventType: string,
): Promise<Record<string, unknown> | null> {
  const events = await listActivity(db, { projectId: await getProjectId(db, prdRevisionId) });
  const match = [...events]
    .reverse()
    .find((e) => e.eventType === eventType && e.prdRevisionId === prdRevisionId);
  if (!match) return null;
  return JSON.parse(match.payload) as Record<string, unknown>;
}

async function getProjectId(db: Database, prdRevisionId: string): Promise<string> {
  const row = await db.query.prdRevisions.findFirst({ where: { id: prdRevisionId } });
  if (!row) throw new Error(`PRD ${prdRevisionId} not found`);
  return row.projectId;
}

const VALID_QUOTE = "go ahead, mark it ready";

describe("PRD lifecycle --user-confirmed gate (PRD 0012 / T1)", () => {
  let db: Database;
  let projectId: string;
  let workspaceId: string;

  beforeEach(async () => {
    vi.resetAllMocks();
    setJsonMode(false);
    ({ db } = createTestDb());
    currentTestDb = db;

    const project = await createProject(db, { name: "uc-project" });
    projectId = project.id;

    const workspace = await addWorkspace(db, {
      projectId,
      path: "/workspace/uc-project",
    });
    workspaceId = workspace.id;

    resolveCurrentWorkspace.mockResolvedValue({ db, ws: workspace });
    getDb.mockResolvedValue(db);
  });

  afterEach(() => {
    setJsonMode(false);
  });

  // ── prd ready ──────────────────────────────────────────────────────────────

  describe("prd ready", () => {
    it("(a) errors when --user-confirmed is absent and bypass env is unset", async () => {
      const prd = await createPrd(db, { projectId, title: "Ready PRD" });
      const { prdCommand } = await import("#/cli/commands/prds");
      const readyCmd = await getSubCommand(prdCommand, "ready");
      const exit = expectProcessExit();

      const stderr = await captureConsoleError(async () => {
        await withoutBypass(async () => {
          await expect(readyCmd.run({ args: { prdId: prd.id } })).rejects.toThrow("process.exit:1");
        });
      });
      expect(stderr).toMatch(/--user-confirmed/);
      expect(stderr).toMatch(/depot prd ready/);

      const after = await db.query.prdRevisions.findFirst({ where: { id: prd.id } });
      expect(after!.status).toBe("draft");

      exit.mockRestore();
    });

    it("(b) rejects --user-confirmed shorter than 6 characters", async () => {
      const prd = await createPrd(db, { projectId, title: "Ready PRD" });
      const { prdCommand } = await import("#/cli/commands/prds");
      const readyCmd = await getSubCommand(prdCommand, "ready");
      const exit = expectProcessExit();

      const stderr = await captureConsoleError(async () => {
        await withoutBypass(async () => {
          await expect(
            readyCmd.run({ args: { prdId: prd.id, userConfirmed: "ok" } }),
          ).rejects.toThrow("process.exit:1");
        });
      });
      expect(stderr).toMatch(/6 characters|too short|length/i);

      const after = await db.query.prdRevisions.findFirst({ where: { id: prd.id } });
      expect(after!.status).toBe("draft");

      exit.mockRestore();
    });

    it("(c) succeeds with a valid quote and persists it in the activity log payload", async () => {
      const prd = await createPrd(db, { projectId, title: "Ready PRD" });
      const { prdCommand } = await import("#/cli/commands/prds");
      const readyCmd = await getSubCommand(prdCommand, "ready");

      const out = vi.spyOn(console, "log").mockImplementation(() => {});
      await withoutBypass(async () => {
        await readyCmd.run({ args: { prdId: prd.id, userConfirmed: VALID_QUOTE } });
      });
      out.mockRestore();

      const after = await db.query.prdRevisions.findFirst({ where: { id: prd.id } });
      expect(after!.status).toBe("ready");

      const payload = await findLatestPayload(db, prd.id, "prd_ready");
      expect(payload).not.toBeNull();
      expect(payload!["userConfirmation"]).toBe(VALID_QUOTE);
    });

    it("(d) bypass env succeeds with no flag and logs userConfirmation: null", async () => {
      const prd = await createPrd(db, { projectId, title: "Ready PRD" });
      const { prdCommand } = await import("#/cli/commands/prds");
      const readyCmd = await getSubCommand(prdCommand, "ready");

      const out = vi.spyOn(console, "log").mockImplementation(() => {});
      await readyCmd.run({ args: { prdId: prd.id } });
      out.mockRestore();

      const after = await db.query.prdRevisions.findFirst({ where: { id: prd.id } });
      expect(after!.status).toBe("ready");

      const payload = await findLatestPayload(db, prd.id, "prd_ready");
      expect(payload).not.toBeNull();
      expect(payload!["userConfirmation"]).toBeNull();
    });
  });

  // ── prd activate ───────────────────────────────────────────────────────────

  describe("prd activate", () => {
    async function setupReady(): Promise<string> {
      const prd = await createPrd(db, { projectId, title: "Activate PRD" });
      await markPrdReady(db, prd.id);
      return prd.id;
    }

    it("(a) errors when --user-confirmed is absent and bypass env is unset", async () => {
      const id = await setupReady();
      const { prdCommand } = await import("#/cli/commands/prds");
      const activateCmd = await getSubCommand(prdCommand, "activate");
      const exit = expectProcessExit();

      const stderr = await captureConsoleError(async () => {
        await withoutBypass(async () => {
          await expect(activateCmd.run({ args: { prdId: id } })).rejects.toThrow("process.exit:1");
        });
      });
      expect(stderr).toMatch(/depot prd activate/);
      expect(stderr).toMatch(/--user-confirmed/);

      const after = await db.query.prdRevisions.findFirst({ where: { id } });
      expect(after!.status).toBe("ready");

      exit.mockRestore();
    });

    it("(b) rejects --user-confirmed shorter than 6 characters", async () => {
      const id = await setupReady();
      const { prdCommand } = await import("#/cli/commands/prds");
      const activateCmd = await getSubCommand(prdCommand, "activate");
      const exit = expectProcessExit();

      const stderr = await captureConsoleError(async () => {
        await withoutBypass(async () => {
          await expect(
            activateCmd.run({ args: { prdId: id, userConfirmed: "go" } }),
          ).rejects.toThrow("process.exit:1");
        });
      });
      expect(stderr).toMatch(/6 characters|too short|length/i);

      const after = await db.query.prdRevisions.findFirst({ where: { id } });
      expect(after!.status).toBe("ready");

      exit.mockRestore();
    });

    it("(c) succeeds with a valid quote and persists it in the activity log payload", async () => {
      const id = await setupReady();
      const { prdCommand } = await import("#/cli/commands/prds");
      const activateCmd = await getSubCommand(prdCommand, "activate");

      const out = vi.spyOn(console, "log").mockImplementation(() => {});
      await withoutBypass(async () => {
        await activateCmd.run({ args: { prdId: id, userConfirmed: VALID_QUOTE } });
      });
      out.mockRestore();

      const after = await db.query.prdRevisions.findFirst({ where: { id } });
      expect(after!.status).toBe("in_progress");

      const payload = await findLatestPayload(db, id, "prd_activated");
      expect(payload).not.toBeNull();
      expect(payload!["userConfirmation"]).toBe(VALID_QUOTE);
    });

    it("(d) bypass env succeeds with no flag and logs userConfirmation: null", async () => {
      const id = await setupReady();
      const { prdCommand } = await import("#/cli/commands/prds");
      const activateCmd = await getSubCommand(prdCommand, "activate");

      const out = vi.spyOn(console, "log").mockImplementation(() => {});
      await activateCmd.run({ args: { prdId: id } });
      out.mockRestore();

      const payload = await findLatestPayload(db, id, "prd_activated");
      expect(payload!["userConfirmation"]).toBeNull();
    });
  });

  // ── prd request-review ─────────────────────────────────────────────────────

  describe("prd request-review", () => {
    async function setupInProgress(): Promise<string> {
      const prd = await createPrd(db, { projectId, title: "Review PRD" });
      await markPrdReady(db, prd.id);
      await activatePrd(db, prd.id, workspaceId);
      return prd.id;
    }

    it("(a) errors when --user-confirmed is absent and bypass env is unset", async () => {
      const id = await setupInProgress();
      const { prdCommand } = await import("#/cli/commands/prds");
      const cmd = await getSubCommand(prdCommand, "request-review");
      const exit = expectProcessExit();

      const stderr = await captureConsoleError(async () => {
        await withoutBypass(async () => {
          await expect(cmd.run({ args: { prdId: id } })).rejects.toThrow("process.exit:1");
        });
      });
      expect(stderr).toMatch(/depot prd request-review/);

      const after = await db.query.prdRevisions.findFirst({ where: { id } });
      expect(after!.status).toBe("in_progress");
      exit.mockRestore();
    });

    it("(b) rejects --user-confirmed shorter than 6 characters", async () => {
      const id = await setupInProgress();
      const { prdCommand } = await import("#/cli/commands/prds");
      const cmd = await getSubCommand(prdCommand, "request-review");
      const exit = expectProcessExit();

      const stderr = await captureConsoleError(async () => {
        await withoutBypass(async () => {
          await expect(cmd.run({ args: { prdId: id, userConfirmed: "ok" } })).rejects.toThrow(
            "process.exit:1",
          );
        });
      });
      expect(stderr).toMatch(/6 characters|too short|length/i);

      const after = await db.query.prdRevisions.findFirst({ where: { id } });
      expect(after!.status).toBe("in_progress");
      exit.mockRestore();
    });

    it("(c) succeeds with a valid quote and persists it in the activity log payload", async () => {
      const id = await setupInProgress();
      const { prdCommand } = await import("#/cli/commands/prds");
      const cmd = await getSubCommand(prdCommand, "request-review");

      const out = vi.spyOn(console, "log").mockImplementation(() => {});
      await withoutBypass(async () => {
        await cmd.run({ args: { prdId: id, userConfirmed: VALID_QUOTE } });
      });
      out.mockRestore();

      const after = await db.query.prdRevisions.findFirst({ where: { id } });
      expect(after!.status).toBe("review");

      const payload = await findLatestPayload(db, id, "prd_review_requested");
      expect(payload!["userConfirmation"]).toBe(VALID_QUOTE);
    });

    it("(d) bypass env succeeds with no flag and logs userConfirmation: null", async () => {
      const id = await setupInProgress();
      const { prdCommand } = await import("#/cli/commands/prds");
      const cmd = await getSubCommand(prdCommand, "request-review");

      const out = vi.spyOn(console, "log").mockImplementation(() => {});
      await cmd.run({ args: { prdId: id } });
      out.mockRestore();

      const payload = await findLatestPayload(db, id, "prd_review_requested");
      expect(payload!["userConfirmation"]).toBeNull();
    });
  });

  // ── prd done ───────────────────────────────────────────────────────────────

  describe("prd done", () => {
    async function setupReview(): Promise<string> {
      const prd = await createPrd(db, { projectId, title: "Done PRD" });
      await markPrdReady(db, prd.id);
      await activatePrd(db, prd.id, workspaceId);
      await requestReviewPrd(db, prd.id);
      return prd.id;
    }

    it("(a) errors when --user-confirmed is absent and bypass env is unset", async () => {
      const id = await setupReview();
      const { prdCommand } = await import("#/cli/commands/prds");
      const cmd = await getSubCommand(prdCommand, "done");
      const exit = expectProcessExit();

      const stderr = await captureConsoleError(async () => {
        await withoutBypass(async () => {
          await expect(cmd.run({ args: { prdId: id } })).rejects.toThrow("process.exit:1");
        });
      });
      expect(stderr).toMatch(/depot prd done/);

      const after = await db.query.prdRevisions.findFirst({ where: { id } });
      expect(after!.status).toBe("review");
      exit.mockRestore();
    });

    it("(b) rejects --user-confirmed shorter than 6 characters", async () => {
      const id = await setupReview();
      const { prdCommand } = await import("#/cli/commands/prds");
      const cmd = await getSubCommand(prdCommand, "done");
      const exit = expectProcessExit();

      const stderr = await captureConsoleError(async () => {
        await withoutBypass(async () => {
          await expect(cmd.run({ args: { prdId: id, userConfirmed: "ok" } })).rejects.toThrow(
            "process.exit:1",
          );
        });
      });
      expect(stderr).toMatch(/6 characters|too short|length/i);

      const after = await db.query.prdRevisions.findFirst({ where: { id } });
      expect(after!.status).toBe("review");
      exit.mockRestore();
    });

    it("(c) succeeds with a valid quote and persists it in the activity log payload", async () => {
      const id = await setupReview();
      const { prdCommand } = await import("#/cli/commands/prds");
      const cmd = await getSubCommand(prdCommand, "done");

      const out = vi.spyOn(console, "log").mockImplementation(() => {});
      await withoutBypass(async () => {
        await cmd.run({ args: { prdId: id, userConfirmed: VALID_QUOTE } });
      });
      out.mockRestore();

      const after = await db.query.prdRevisions.findFirst({ where: { id } });
      expect(after!.status).toBe("done");

      const payload = await findLatestPayload(db, id, "prd_done");
      expect(payload!["userConfirmation"]).toBe(VALID_QUOTE);
    });

    it("(d) bypass env succeeds with no flag and logs userConfirmation: null", async () => {
      const id = await setupReview();
      const { prdCommand } = await import("#/cli/commands/prds");
      const cmd = await getSubCommand(prdCommand, "done");

      const out = vi.spyOn(console, "log").mockImplementation(() => {});
      await cmd.run({ args: { prdId: id } });
      out.mockRestore();

      const payload = await findLatestPayload(db, id, "prd_done");
      expect(payload!["userConfirmation"]).toBeNull();
    });
  });

  // ── prd phase-advance ──────────────────────────────────────────────────────

  describe("prd phase-advance", () => {
    async function setupPhasedInProgress(): Promise<string> {
      const prd = await createPrd(db, { projectId, title: "Phased PRD" });
      // Two phases so phase-advance can step from 1 to 2 without ending.
      const phase1 = await createTask(db, {
        prdRevisionId: prd.id,
        title: "Phase 1 task",
        description: "x",
        doneCriteria: "x",
        effort: "s",
        phaseNumber: 1,
      });
      await createTask(db, {
        prdRevisionId: prd.id,
        title: "Phase 2 task",
        description: "x",
        doneCriteria: "x",
        effort: "s",
        phaseNumber: 2,
      });
      await db
        .update(prdRevisions)
        .set({ status: "ready", currentPhase: 1 })
        .where(eq(prdRevisions.id, prd.id));
      await activatePrd(db, prd.id, workspaceId);
      await startTask(db, phase1.id);
      await completeTask(db, phase1.id);
      // phase-advance requires the PRD to be in `review` (post-audit gate).
      await requestReviewPrd(db, prd.id);
      return prd.id;
    }

    it("(a) errors when --user-confirmed is absent and bypass env is unset", async () => {
      const id = await setupPhasedInProgress();
      const { prdCommand } = await import("#/cli/commands/prds");
      const cmd = await getSubCommand(prdCommand, "phase-advance");
      const exit = expectProcessExit();

      const stderr = await captureConsoleError(async () => {
        await withoutBypass(async () => {
          await expect(cmd.run({ args: { prdId: id } })).rejects.toThrow("process.exit:1");
        });
      });
      expect(stderr).toMatch(/depot prd phase-advance/);

      const after = await db.query.prdRevisions.findFirst({ where: { id } });
      expect(after!.currentPhase).toBe(1);
      exit.mockRestore();
    });

    it("(b) rejects --user-confirmed shorter than 6 characters", async () => {
      const id = await setupPhasedInProgress();
      const { prdCommand } = await import("#/cli/commands/prds");
      const cmd = await getSubCommand(prdCommand, "phase-advance");
      const exit = expectProcessExit();

      const stderr = await captureConsoleError(async () => {
        await withoutBypass(async () => {
          await expect(cmd.run({ args: { prdId: id, userConfirmed: "ok" } })).rejects.toThrow(
            "process.exit:1",
          );
        });
      });
      expect(stderr).toMatch(/6 characters|too short|length/i);

      const after = await db.query.prdRevisions.findFirst({ where: { id } });
      expect(after!.currentPhase).toBe(1);
      exit.mockRestore();
    });

    it("(c) succeeds with a valid quote and persists it in the activity log payload", async () => {
      const id = await setupPhasedInProgress();
      const { prdCommand } = await import("#/cli/commands/prds");
      const cmd = await getSubCommand(prdCommand, "phase-advance");

      const out = vi.spyOn(console, "log").mockImplementation(() => {});
      await withoutBypass(async () => {
        await cmd.run({ args: { prdId: id, userConfirmed: VALID_QUOTE } });
      });
      out.mockRestore();

      const after = await db.query.prdRevisions.findFirst({ where: { id } });
      expect(after!.currentPhase).toBe(2);

      const payload = await findLatestPayload(db, id, "phase_advanced");
      expect(payload!["userConfirmation"]).toBe(VALID_QUOTE);
    });

    it("(d) bypass env succeeds with no flag and logs userConfirmation: null", async () => {
      const id = await setupPhasedInProgress();
      const { prdCommand } = await import("#/cli/commands/prds");
      const cmd = await getSubCommand(prdCommand, "phase-advance");

      const out = vi.spyOn(console, "log").mockImplementation(() => {});
      await cmd.run({ args: { prdId: id } });
      out.mockRestore();

      const payload = await findLatestPayload(db, id, "phase_advanced");
      expect(payload!["userConfirmation"]).toBeNull();
    });
  });

  // ── prd cancel ─────────────────────────────────────────────────────────────

  describe("prd cancel", () => {
    it("(a) errors when --user-confirmed is absent and bypass env is unset", async () => {
      const prd = await createPrd(db, { projectId, title: "Cancel PRD" });
      const { prdCommand } = await import("#/cli/commands/prds");
      const cmd = await getSubCommand(prdCommand, "cancel");
      const exit = expectProcessExit();

      const stderr = await captureConsoleError(async () => {
        await withoutBypass(async () => {
          await expect(cmd.run({ args: { prdId: prd.id } })).rejects.toThrow("process.exit:1");
        });
      });
      expect(stderr).toMatch(/depot prd cancel/);

      const after = await db.query.prdRevisions.findFirst({ where: { id: prd.id } });
      expect(after!.status).toBe("draft");
      exit.mockRestore();
    });

    it("(b) rejects --user-confirmed shorter than 6 characters", async () => {
      const prd = await createPrd(db, { projectId, title: "Cancel PRD" });
      const { prdCommand } = await import("#/cli/commands/prds");
      const cmd = await getSubCommand(prdCommand, "cancel");
      const exit = expectProcessExit();

      const stderr = await captureConsoleError(async () => {
        await withoutBypass(async () => {
          await expect(cmd.run({ args: { prdId: prd.id, userConfirmed: "ok" } })).rejects.toThrow(
            "process.exit:1",
          );
        });
      });
      expect(stderr).toMatch(/6 characters|too short|length/i);

      const after = await db.query.prdRevisions.findFirst({ where: { id: prd.id } });
      expect(after!.status).toBe("draft");
      exit.mockRestore();
    });

    it("(c) succeeds with a valid quote and persists it in the activity log payload", async () => {
      const prd = await createPrd(db, { projectId, title: "Cancel PRD" });
      const { prdCommand } = await import("#/cli/commands/prds");
      const cmd = await getSubCommand(prdCommand, "cancel");

      const out = vi.spyOn(console, "log").mockImplementation(() => {});
      await withoutBypass(async () => {
        await cmd.run({ args: { prdId: prd.id, userConfirmed: "please cancel this draft" } });
      });
      out.mockRestore();

      const after = await db.query.prdRevisions.findFirst({ where: { id: prd.id } });
      expect(after!.status).toBe("canceled");

      const payload = await findLatestPayload(db, prd.id, "prd_canceled");
      expect(payload!["userConfirmation"]).toBe("please cancel this draft");
    });

    it("(d) bypass env succeeds with no flag and logs userConfirmation: null", async () => {
      const prd = await createPrd(db, { projectId, title: "Cancel PRD" });
      const { prdCommand } = await import("#/cli/commands/prds");
      const cmd = await getSubCommand(prdCommand, "cancel");

      const out = vi.spyOn(console, "log").mockImplementation(() => {});
      await cmd.run({ args: { prdId: prd.id } });
      out.mockRestore();

      const payload = await findLatestPayload(db, prd.id, "prd_canceled");
      expect(payload!["userConfirmation"]).toBeNull();
    });
  });

  // ── prd close (wrapper) ────────────────────────────────────────────────────

  describe("prd close (wrapper)", () => {
    async function setupReady(title = "Close PRD"): Promise<string> {
      const prd = await createPrd(db, { projectId, title });
      await markPrdReady(db, prd.id);
      return prd.id;
    }

    it("(a) errors when --user-confirmed is absent and bypass env is unset", async () => {
      const id = await setupReady();
      const { prdCommand } = await import("#/cli/commands/prds");
      const cmd = await getSubCommand(prdCommand, "close");
      const exit = expectProcessExit();

      const stderr = await captureConsoleError(async () => {
        await withoutBypass(async () => {
          await expect(cmd.run({ args: { prdId: id } })).rejects.toThrow("process.exit:1");
        });
      });
      expect(stderr).toMatch(/depot prd close/);

      const after = await db.query.prdRevisions.findFirst({ where: { id } });
      expect(after!.status).toBe("ready");
      exit.mockRestore();
    });

    it("(b) rejects --user-confirmed shorter than 6 characters", async () => {
      const id = await setupReady();
      const { prdCommand } = await import("#/cli/commands/prds");
      const cmd = await getSubCommand(prdCommand, "close");
      const exit = expectProcessExit();

      const stderr = await captureConsoleError(async () => {
        await withoutBypass(async () => {
          await expect(cmd.run({ args: { prdId: id, userConfirmed: "ok" } })).rejects.toThrow(
            "process.exit:1",
          );
        });
      });
      expect(stderr).toMatch(/6 characters|too short|length/i);

      const after = await db.query.prdRevisions.findFirst({ where: { id } });
      expect(after!.status).toBe("ready");
      exit.mockRestore();
    });

    it("(c) propagates a single quote across the three internal transitions", async () => {
      const id = await setupReady();
      const { prdCommand } = await import("#/cli/commands/prds");
      const cmd = await getSubCommand(prdCommand, "close");
      const quote = "approved, close this PRD";

      const out = vi.spyOn(console, "log").mockImplementation(() => {});
      await withoutBypass(async () => {
        await cmd.run({ args: { prdId: id, userConfirmed: quote } });
      });
      out.mockRestore();

      const after = await db.query.prdRevisions.findFirst({ where: { id } });
      expect(after!.status).toBe("done");

      const activated = await findLatestPayload(db, id, "prd_activated");
      const reviewRequested = await findLatestPayload(db, id, "prd_review_requested");
      const done = await findLatestPayload(db, id, "prd_done");

      expect(activated!["userConfirmation"]).toBe(quote);
      expect(reviewRequested!["userConfirmation"]).toBe(quote);
      expect(done!["userConfirmation"]).toBe(quote);
    });

    it("(d) bypass env succeeds with no flag and logs userConfirmation: null on all three events", async () => {
      const id = await setupReady();
      const { prdCommand } = await import("#/cli/commands/prds");
      const cmd = await getSubCommand(prdCommand, "close");

      const out = vi.spyOn(console, "log").mockImplementation(() => {});
      await cmd.run({ args: { prdId: id } });
      out.mockRestore();

      const activated = await findLatestPayload(db, id, "prd_activated");
      const reviewRequested = await findLatestPayload(db, id, "prd_review_requested");
      const done = await findLatestPayload(db, id, "prd_done");

      expect(activated!["userConfirmation"]).toBeNull();
      expect(reviewRequested!["userConfirmation"]).toBeNull();
      expect(done!["userConfirmation"]).toBeNull();
    });
  });
});
