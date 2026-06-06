import { describe, it, expect, beforeEach } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { createTestDb } from "../helpers/db";
import type { Database } from "#/db/client";
import { prdRevisions } from "#/db/schema";
import {
  createProject,
  addWorkspace,
  createPrd,
  activatePrd,
  createTask,
  listTasks,
  triageTask,
  getTask,
  listActivityForTask,
} from "#/lib/workflow";

/**
 * PRD 0020 / T1 — surfacing the triage axis on PRD tasks.
 *
 * These unit tests exercise the domain `triageTask` (re-exported through the
 * workflow shim) plus the default triage state on newly created tasks. The CLI
 * `task triage` subcommand and `task list --triage` filter are covered
 * end-to-end in `tests/e2e/scenarios/task-triage.e2e.test.ts`; here we assert
 * the storage/transition contract the CLI depends on.
 */

let db: Database;
let prdRevisionId: string;

beforeEach(async () => {
  const result = createTestDb();
  db = result.db;
  const project = await createProject(db, { name: "triage-app" });
  const ws = await addWorkspace(db, { projectId: project.id, path: "/home/user/triage-app" });
  const prd = await createPrd(db, { projectId: project.id, title: "Triage PRD" });
  await db.update(prdRevisions).set({ status: "ready" }).where(eq(prdRevisions.id, prd.id));
  await activatePrd(db, prd.id, ws.id);
  prdRevisionId = prd.id;
});

async function seedTask(title: string) {
  return createTask(db, {
    prdRevisionId,
    title,
    description: "Implement the thing",
    doneCriteria: "It works",
    effort: "m",
  });
}

describe("task triage (PRD 0020 / T1)", () => {
  it("new tasks default to triageState ready-for-agent", async () => {
    const task = await seedTask("Default triage");
    expect(task.triageState).toBe("ready-for-agent");
  });

  it("triageTask sets the requested state and persists it", async () => {
    const task = await seedTask("Needs more info");
    const updated = await triageTask(db, task.id, "needs-info", { reason: "spec unclear" });
    expect(updated.triageState).toBe("needs-info");

    const reloaded = await getTask(db, task.id);
    expect(reloaded?.triageState).toBe("needs-info");
  });

  it("triageTask records an activity note with the previous → next transition", async () => {
    const task = await seedTask("Triaged with reason");
    await triageTask(db, task.id, "wontfix", { reason: "out of scope", source: "human" });

    const events = await listActivityForTask(db, task.id);
    const note = events.find((e) => e.eventType === "note");
    expect(note).toBeDefined();
    const payload = JSON.parse(note!.payload) as { message: string };
    expect(payload.message).toContain("ready-for-agent");
    expect(payload.message).toContain("wontfix");
    expect(payload.message).toContain("out of scope");
    expect(note!.source).toBe("human");
  });

  it("supports filtering listed tasks by triage state (mirrors `task list --triage`)", async () => {
    const a = await seedTask("Actionable");
    const b = await seedTask("Parked");
    await triageTask(db, b.id, "needs-info");

    const all = await listTasks(db, prdRevisionId);
    const needsInfo = all.filter((t) => t.triageState === "needs-info");
    expect(needsInfo.map((t) => t.id)).toEqual([b.id]);

    const readyForAgent = all.filter((t) => t.triageState === "ready-for-agent");
    expect(readyForAgent.map((t) => t.id)).toContain(a.id);
    expect(readyForAgent.map((t) => t.id)).not.toContain(b.id);
  });
});
