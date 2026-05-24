import { describe, it, expect, beforeEach } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { createTestDb } from "../helpers/db";
import type { Database } from "#/db/client";
import { prdRevisions } from "#/db/schema";
import {
  createProject,
  addWorkspace,
  createPrd,
  getPrd,
  listPrds,
  markPrdReady,
  updatePrd,
  donePrd,
  cancelPrd,
  requestReviewPrd,
  resumePrd,
  forkPrd,
  listPrdFamily,
  createReview,
  getReview,
  listReviews,
  startReview,
  updateReview,
  doneReview,
  addReviewTask,
  listReviewTasks,
  updateTask,
} from "#/lib/workflow";

let db: Database;

beforeEach(async () => {
  const result = await createTestDb();
  db = result.db;
});

// ── PRD Workflow ─────────────────────────────────────────────────────────────

describe("PRD workflow", () => {
  let projectId: string;
  beforeEach(async () => {
    const project = await createProject(db, { name: "my-app" });
    projectId = project.id;
    await addWorkspace(db, { projectId, path: "/home/user/my-app" });
  });

  it("creates a PRD with prdId pointing to the logical PRD", async () => {
    const prd = await createPrd(db, { projectId, title: "PRD v1" });
    expect(prd.prdId).toBeTruthy();
    expect(prd.revision).toBe(1);
  });

  it("marks a draft PRD as ready", async () => {
    const prd = await createPrd(db, { projectId, title: "PRD" });
    const ready = await markPrdReady(db, prd.id);
    expect(ready.status).toBe("ready");
    expect(ready.readyAt).toBeTruthy();
  });

  it("updates a draft PRD in place", async () => {
    const prd = await createPrd(db, { projectId, title: "PRD" });
    const updated = await updatePrd(db, prd.id, {
      title: "Updated PRD",
      context: "new context",
    });

    expect(updated.title).toBe("Updated PRD");
    expect(updated.context).toBe("new context");
  });

  it("rejects updatePrd on non-draft PRD", async () => {
    const prd = await createPrd(db, { projectId, title: "PRD" });
    await db.update(prdRevisions).set({ status: "ready" }).where(eq(prdRevisions.id, prd.id));

    await expect(updatePrd(db, prd.id, { title: "Updated" })).rejects.toThrow(/only draft PRDs/i);
  });

  it("rejects markPrdReady on non-draft PRD", async () => {
    const prd = await createPrd(db, { projectId, title: "PRD" });
    await db.update(prdRevisions).set({ status: "in_progress" }).where(eq(prdRevisions.id, prd.id));
    await expect(markPrdReady(db, prd.id)).rejects.toThrow(/invalid prd transition/i);
  });

  it("rejects donePrd from in_progress — must cross the review gate first", async () => {
    const prd = await createPrd(db, { projectId, title: "PRD" });
    await db.update(prdRevisions).set({ status: "in_progress" }).where(eq(prdRevisions.id, prd.id));
    await expect(donePrd(db, prd.id)).rejects.toThrow(/invalid prd transition/i);
  });

  it("rejects donePrd on non-in_progress PRD", async () => {
    const prd = await createPrd(db, { projectId, title: "PRD" });
    await expect(donePrd(db, prd.id)).rejects.toThrow(/invalid prd transition/i);
  });

  it("transitions in_progress → review via requestReviewPrd", async () => {
    const prd = await createPrd(db, { projectId, title: "PRD" });
    await db.update(prdRevisions).set({ status: "in_progress" }).where(eq(prdRevisions.id, prd.id));
    const inReview = await requestReviewPrd(db, prd.id, "phase audit clean");
    expect(inReview.status).toBe("review");
  });

  it("transitions review → in_progress via resumePrd", async () => {
    const prd = await createPrd(db, { projectId, title: "PRD" });
    await db.update(prdRevisions).set({ status: "review" }).where(eq(prdRevisions.id, prd.id));
    const resumed = await resumePrd(db, prd.id);
    expect(resumed.status).toBe("in_progress");
  });

  it("transitions review → done via donePrd (user approval path)", async () => {
    const prd = await createPrd(db, { projectId, title: "PRD" });
    await db.update(prdRevisions).set({ status: "review" }).where(eq(prdRevisions.id, prd.id));
    const done = await donePrd(db, prd.id);
    expect(done.status).toBe("done");
  });

  it("transitions review → canceled via cancelPrd", async () => {
    const prd = await createPrd(db, { projectId, title: "PRD" });
    await db.update(prdRevisions).set({ status: "review" }).where(eq(prdRevisions.id, prd.id));
    const canceled = await cancelPrd(db, prd.id);
    expect(canceled.status).toBe("canceled");
  });

  it("rejects requestReviewPrd from a draft PRD", async () => {
    const prd = await createPrd(db, { projectId, title: "PRD" });
    await expect(requestReviewPrd(db, prd.id)).rejects.toThrow(/invalid prd transition/i);
  });

  it("rejects resumePrd from in_progress (only valid from review)", async () => {
    const prd = await createPrd(db, { projectId, title: "PRD" });
    await db.update(prdRevisions).set({ status: "in_progress" }).where(eq(prdRevisions.id, prd.id));
    await expect(resumePrd(db, prd.id)).rejects.toThrow(/invalid prd transition/i);
  });

  it("rejects phaseAdvance from in_progress with a hint to open the review gate", async () => {
    const { phaseAdvance, loadPrd, activatePrd, startTask, completeTask, listTasks } =
      await import("#/lib/workflow");
    const project = await createProject(db, { name: "phase-gate-test" });
    const ws = await addWorkspace(db, {
      projectId: project.id,
      label: "main",
      path: "/tmp/phase-gate-test",
    });
    const { prd: rev } = await loadPrd(db, {
      projectId: project.id,
      title: "Phased PRD",
      ready: true,
      tasks: [
        {
          title: "P1",
          description: "Phase 1 work",
          doneCriteria: "done",
          effort: "s",
          dependsOn: [],
          phaseNumber: 1,
        },
        {
          title: "P2",
          description: "Phase 2 work",
          doneCriteria: "done",
          effort: "s",
          dependsOn: [],
          phaseNumber: 2,
        },
      ],
    });
    await activatePrd(db, rev.id, ws.id);
    const p1 = (await listTasks(db, rev.id)).find((t) => t.phaseNumber === 1)!;
    await startTask(db, p1.id);
    await completeTask(db, p1.id);

    // PRD is still in_progress — phaseAdvance must reject and hint at the
    // request-review command.
    await expect(phaseAdvance(db, rev.id)).rejects.toThrow(/not in 'review'.*request-review/i);
  });

  it("flips a review PRD back to in_progress when phaseAdvance moves to the next phase", async () => {
    const { phaseAdvance, loadPrd, activatePrd, startTask, completeTask, listTasks } =
      await import("#/lib/workflow");
    const project = await createProject(db, { name: "phase-flip-test" });
    const ws = await addWorkspace(db, {
      projectId: project.id,
      label: "main",
      path: "/tmp/phase-flip-test",
    });
    const { prd: rev } = await loadPrd(db, {
      projectId: project.id,
      title: "Phased PRD",
      ready: true,
      tasks: [
        {
          title: "P1",
          description: "Phase 1",
          doneCriteria: "done",
          effort: "s",
          dependsOn: [],
          phaseNumber: 1,
        },
        {
          title: "P2",
          description: "Phase 2",
          doneCriteria: "done",
          effort: "s",
          dependsOn: [],
          phaseNumber: 2,
        },
      ],
    });
    await activatePrd(db, rev.id, ws.id);
    const p1 = (await listTasks(db, rev.id)).find((t) => t.phaseNumber === 1)!;
    await startTask(db, p1.id);
    await completeTask(db, p1.id);
    await requestReviewPrd(db, rev.id);

    const advanced = await phaseAdvance(db, rev.id);
    expect(advanced.advanced).toBe(true);
    expect(advanced.prd.status).toBe("in_progress");
    expect(advanced.prd.currentPhase).toBe(2);
  });

  it("rejects starting a base task ahead of currentPhase", async () => {
    const { loadPrd, activatePrd, startTask, listTasks } = await import("#/lib/workflow");
    const project = await createProject(db, { name: "task-phase-gate" });
    const ws = await addWorkspace(db, {
      projectId: project.id,
      label: "main",
      path: "/tmp/task-phase-gate",
    });
    const { prd: rev } = await loadPrd(db, {
      projectId: project.id,
      title: "Phased PRD",
      ready: true,
      tasks: [
        {
          title: "P1",
          description: "Phase 1",
          doneCriteria: "done",
          effort: "s",
          dependsOn: [],
          phaseNumber: 1,
        },
        {
          title: "P2",
          description: "Phase 2",
          doneCriteria: "done",
          effort: "s",
          dependsOn: [],
          phaseNumber: 2,
        },
      ],
    });
    await activatePrd(db, rev.id, ws.id);
    const p2 = (await listTasks(db, rev.id)).find((t) => t.phaseNumber === 2)!;

    // Trying to skip ahead — should fail.
    await expect(startTask(db, p2.id)).rejects.toThrow(/in phase 2 but the PRD is on phase 1/i);
  });

  it("forks a ready PRD into a new draft revision", async () => {
    const v1 = await createPrd(db, { projectId, title: "PRD" });
    await db.update(prdRevisions).set({ status: "ready" }).where(eq(prdRevisions.id, v1.id));

    const v2 = await forkPrd(db, v1.id);
    expect(v2.revision).toBe(2);
    expect(v2.status).toBe("draft");

    // v1 should still be ready
    const updatedV1 = await getPrd(db, v1.id);
    expect(updatedV1!.status).toBe("ready");
  });

  it("rejects forkPrd on non-ready PRD", async () => {
    const prd = await createPrd(db, { projectId, title: "PRD" });
    await expect(forkPrd(db, prd.id)).rejects.toThrow(/cannot fork prd/i);
  });

  it("lists entire PRD family by rootId", async () => {
    const v1 = await createPrd(db, { projectId, title: "PRD" });
    await db.update(prdRevisions).set({ status: "ready" }).where(eq(prdRevisions.id, v1.id));
    const v2 = await forkPrd(db, v1.id);
    await db.update(prdRevisions).set({ status: "ready" }).where(eq(prdRevisions.id, v2.id));
    const _v3 = await forkPrd(db, v2.id);

    const family = await listPrdFamily(db, v1.prdId);
    expect(family).toHaveLength(3);
    expect(family.map((p) => p.revision)).toEqual([1, 2, 3]);
  });

  it("listPrds with latestOnly filters out superseded revisions", async () => {
    const v1 = await createPrd(db, { projectId, title: "PRD" });
    await db.update(prdRevisions).set({ status: "ready" }).where(eq(prdRevisions.id, v1.id));
    await forkPrd(db, v1.id); // creates v2

    const all = await listPrds(db, { projectId });
    expect(all).toHaveLength(2);

    const latest = await listPrds(db, { projectId, latestOnly: true });
    expect(latest).toHaveLength(1);
    expect(latest[0]!.revision).toBe(2);
  });
});

// ── Review Workflow ───────────────────────────────────────────────────────────

describe("review workflow", () => {
  let projectId: string;
  let prdRevisionId: string;

  beforeEach(async () => {
    const project = await createProject(db, { name: "my-app" });
    projectId = project.id;
    await addWorkspace(db, { projectId, path: "/home/user/my-app" });
    const prd = await createPrd(db, { projectId, title: "PRD" });
    prdRevisionId = prd.id;
  });

  it("creates a review in draft status", async () => {
    const review = await createReview(db, { prdRevisionId, type: "agent" });
    expect(review.status).toBe("draft");
    expect(review.type).toBe("agent");
    expect(review.prdRevisionId).toBe(prdRevisionId);
  });

  it("starts a review (draft → in_progress)", async () => {
    const review = await createReview(db, { prdRevisionId, type: "agent" });
    const started = await startReview(db, review.id);
    expect(started.status).toBe("in_progress");
  });

  it("updates review feedback in draft", async () => {
    const review = await createReview(db, { prdRevisionId, type: "human" });
    const updated = await updateReview(db, review.id, { userFeedback: "Need smaller scope" });

    expect(updated.userFeedback).toBe("Need smaller scope");
    expect(updated.status).toBe("draft");
  });

  it("rejects startReview on non-draft review", async () => {
    const review = await createReview(db, { prdRevisionId, type: "agent" });
    await startReview(db, review.id);
    await expect(startReview(db, review.id)).rejects.toThrow(/invalid review transition/i);
  });

  it("marks a review as done (in_progress → done)", async () => {
    const review = await createReview(db, { prdRevisionId, type: "agent" });
    await startReview(db, review.id);
    const done = await doneReview(db, review.id);
    expect(done.status).toBe("done");
    expect(done.doneAt).toBeTruthy();
  });

  it("allows doneReview directly on a draft review (no findings case)", async () => {
    const review = await createReview(db, { prdRevisionId, type: "agent" });
    const done = await doneReview(db, review.id);
    expect(done.status).toBe("done");
    expect(done.doneAt).toBeTruthy();
  });

  it("adds a task to a review with severity", async () => {
    const review = await createReview(db, { prdRevisionId, type: "agent" });
    const task = await addReviewTask(db, review.id, {
      title: "Fix missing validation",
      description: "Input is not validated",
      doneCriteria: "Validation added and tested",
      severity: "major",
    });
    expect(task.reviewId).toBe(review.id);
    expect(task.severity).toBe("major");
    expect(task.prdRevisionId).toBe(prdRevisionId);
    expect(task.status).toBe("pending");
    const reviewAfter = await getReview(db, review.id);
    expect(reviewAfter!.status).toBe("draft");
  });

  it("updates a review task in place", async () => {
    const review = await createReview(db, { prdRevisionId, type: "agent" });
    const task = await addReviewTask(db, review.id, {
      title: "Fix missing validation",
      description: "Input is not validated",
      doneCriteria: "Validation added and tested",
      severity: "major",
    });

    const updated = await updateTask(db, task.id, {
      description:
        "Intent:\nHarden validation.\n\nScope:\n- Validate agent input.\n\nNon-goals:\n- Do not change output format.",
      doneCriteria: "Validation rejects invalid input",
    });

    expect(updated.description).toContain("Intent:");
    expect(updated.doneCriteria).toBe("Validation rejects invalid input");
  });

  it("does not allow doneReview on draft review with findings", async () => {
    const review = await createReview(db, { prdRevisionId, type: "agent" });
    await addReviewTask(db, review.id, {
      title: "Fix missing validation",
      description: "Input is not validated",
      doneCriteria: "Validation added and tested",
      severity: "major",
    });

    await expect(doneReview(db, review.id)).rejects.toThrow(/validate it first/i);
  });

  it("adds a task to a review without severity", async () => {
    const review = await createReview(db, { prdRevisionId, type: "agent" });
    const task = await addReviewTask(db, review.id, {
      title: "Refactor function",
      description: "Cleanup code",
      doneCriteria: "Code cleaned",
    });
    expect(task.severity).toBeNull();
  });

  it("lists tasks for a review", async () => {
    const review = await createReview(db, { prdRevisionId, type: "human" });
    await addReviewTask(db, review.id, {
      title: "Task 1",
      description: "desc",
      doneCriteria: "done",
      severity: "minor",
    });
    await addReviewTask(db, review.id, {
      title: "Task 2",
      description: "desc",
      doneCriteria: "done",
      severity: "critical",
    });
    const tasks = await listReviewTasks(db, review.id);
    expect(tasks).toHaveLength(2);
  });

  it("lists reviews for a PRD", async () => {
    await createReview(db, { prdRevisionId, type: "agent" });
    await createReview(db, { prdRevisionId, type: "human" });
    const list = await listReviews(db, prdRevisionId);
    expect(list).toHaveLength(2);
    expect(list.map((r) => r.type).sort()).toEqual(["agent", "human"]);
  });

  it("getReview returns null for non-existent review", async () => {
    const result = await getReview(db, "nonexistent");
    expect(result).toBeNull();
  });

  it("rejects addReviewTask with empty done_criteria", async () => {
    const review = await createReview(db, { prdRevisionId, type: "agent" });
    await expect(
      addReviewTask(db, review.id, {
        title: "Task",
        description: "desc",
        doneCriteria: "",
      }),
    ).rejects.toThrow(/done_criteria/i);
  });
});
