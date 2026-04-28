import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../helpers/db";
import type { Database } from "#/db/client";
import { prds } from "#/db/schema";
import {
  createProject,
  addWorkspace,
  createPrd,
  getPrd,
  listPrds,
  markPrdReady,
  updatePrd,
  donePrd,
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

  it("creates a PRD with rootId pointing to itself", async () => {
    const prd = await createPrd(db, { projectId, title: "PRD v1" });
    expect(prd.rootId).toBe(prd.id);
    expect(prd.parentId).toBeNull();
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
    await db.update(prds).set({ status: "ready" }).where(eq(prds.id, prd.id));

    await expect(updatePrd(db, prd.id, { title: "Updated" })).rejects.toThrow(/only draft PRDs/i);
  });

  it("rejects markPrdReady on non-draft PRD", async () => {
    const prd = await createPrd(db, { projectId, title: "PRD" });
    await db.update(prds).set({ status: "in_progress" }).where(eq(prds.id, prd.id));
    await expect(markPrdReady(db, prd.id)).rejects.toThrow(/invalid prd transition/i);
  });

  it("marks an in_progress PRD as done", async () => {
    const prd = await createPrd(db, { projectId, title: "PRD" });
    await db.update(prds).set({ status: "in_progress" }).where(eq(prds.id, prd.id));
    const done = await donePrd(db, prd.id);
    expect(done.status).toBe("done");
  });

  it("rejects donePrd on non-in_progress PRD", async () => {
    const prd = await createPrd(db, { projectId, title: "PRD" });
    await expect(donePrd(db, prd.id)).rejects.toThrow(/invalid prd transition/i);
  });

  it("forks a ready PRD into a new draft revision", async () => {
    const v1 = await createPrd(db, { projectId, title: "PRD" });
    await db.update(prds).set({ status: "ready" }).where(eq(prds.id, v1.id));

    const v2 = await forkPrd(db, v1.id);
    expect(v2.parentId).toBe(v1.id);
    expect(v2.rootId).toBe(v1.id);
    expect(v2.revision).toBe(2);
    expect(v2.status).toBe("draft");

    // v1 should still be ready
    const updatedV1 = await getPrd(db, v1.id);
    expect(updatedV1!.status).toBe("ready");
  });

  it("rejects forkPrd on non-ready PRD", async () => {
    const prd = await createPrd(db, { projectId, title: "PRD" });
    await expect(forkPrd(db, prd.id)).rejects.toThrow(/invalid prd transition/i);
  });

  it("lists entire PRD family by rootId", async () => {
    const v1 = await createPrd(db, { projectId, title: "PRD" });
    await db.update(prds).set({ status: "ready" }).where(eq(prds.id, v1.id));
    const v2 = await forkPrd(db, v1.id);
    await db.update(prds).set({ status: "ready" }).where(eq(prds.id, v2.id));
    const v3 = await forkPrd(db, v2.id);

    const family = await listPrdFamily(db, v1.id);
    expect(family).toHaveLength(3);
    expect(family.map((p) => p.revision)).toEqual([1, 2, 3]);
    expect(v3.rootId).toBe(v1.id);
  });

  it("listPrds with latestOnly filters out superseded revisions", async () => {
    const v1 = await createPrd(db, { projectId, title: "PRD" });
    await db.update(prds).set({ status: "ready" }).where(eq(prds.id, v1.id));
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
  let prdId: string;

  beforeEach(async () => {
    const project = await createProject(db, { name: "my-app" });
    projectId = project.id;
    await addWorkspace(db, { projectId, path: "/home/user/my-app" });
    const prd = await createPrd(db, { projectId, title: "PRD" });
    prdId = prd.id;
  });

  it("creates a review in draft status", async () => {
    const review = await createReview(db, { prdId, type: "agent" });
    expect(review.status).toBe("draft");
    expect(review.type).toBe("agent");
    expect(review.prdId).toBe(prdId);
  });

  it("starts a review (draft → in_progress)", async () => {
    const review = await createReview(db, { prdId, type: "agent" });
    const started = await startReview(db, review.id);
    expect(started.status).toBe("in_progress");
  });

  it("updates review feedback in draft", async () => {
    const review = await createReview(db, { prdId, type: "human" });
    const updated = await updateReview(db, review.id, { userFeedback: "Need smaller scope" });

    expect(updated.userFeedback).toBe("Need smaller scope");
    expect(updated.status).toBe("draft");
  });

  it("rejects startReview on non-draft review", async () => {
    const review = await createReview(db, { prdId, type: "agent" });
    await startReview(db, review.id);
    await expect(startReview(db, review.id)).rejects.toThrow(/invalid review transition/i);
  });

  it("marks a review as done (in_progress → done)", async () => {
    const review = await createReview(db, { prdId, type: "agent" });
    await startReview(db, review.id);
    const done = await doneReview(db, review.id);
    expect(done.status).toBe("done");
    expect(done.doneAt).toBeTruthy();
  });

  it("allows doneReview directly on a draft review (no findings case)", async () => {
    const review = await createReview(db, { prdId, type: "agent" });
    const done = await doneReview(db, review.id);
    expect(done.status).toBe("done");
    expect(done.doneAt).toBeTruthy();
  });

  it("adds a task to a review with severity", async () => {
    const review = await createReview(db, { prdId, type: "agent" });
    const task = await addReviewTask(db, review.id, {
      title: "Fix missing validation",
      description: "Input is not validated",
      doneCriteria: "Validation added and tested",
      severity: "major",
    });
    expect(task.reviewId).toBe(review.id);
    expect(task.severity).toBe("major");
    expect(task.prdId).toBe(prdId);
    expect(task.status).toBe("pending");
    const reviewAfter = await getReview(db, review.id);
    expect(reviewAfter!.status).toBe("draft");
  });

  it("updates a review task in place", async () => {
    const review = await createReview(db, { prdId, type: "agent" });
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
    const review = await createReview(db, { prdId, type: "agent" });
    await addReviewTask(db, review.id, {
      title: "Fix missing validation",
      description: "Input is not validated",
      doneCriteria: "Validation added and tested",
      severity: "major",
    });

    await expect(doneReview(db, review.id)).rejects.toThrow(/validate it first/i);
  });

  it("adds a task to a review without severity", async () => {
    const review = await createReview(db, { prdId, type: "agent" });
    const task = await addReviewTask(db, review.id, {
      title: "Refactor function",
      description: "Cleanup code",
      doneCriteria: "Code cleaned",
    });
    expect(task.severity).toBeNull();
  });

  it("lists tasks for a review", async () => {
    const review = await createReview(db, { prdId, type: "human" });
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
    await createReview(db, { prdId, type: "agent" });
    await createReview(db, { prdId, type: "human" });
    const list = await listReviews(db, prdId);
    expect(list).toHaveLength(2);
    expect(list.map((r) => r.type).sort()).toEqual(["agent", "human"]);
  });

  it("getReview returns null for non-existent review", async () => {
    const result = await getReview(db, "nonexistent");
    expect(result).toBeNull();
  });

  it("rejects addReviewTask with empty done_criteria", async () => {
    const review = await createReview(db, { prdId, type: "agent" });
    await expect(
      addReviewTask(db, review.id, {
        title: "Task",
        description: "desc",
        doneCriteria: "",
      }),
    ).rejects.toThrow(/done_criteria/i);
  });
});
