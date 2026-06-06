import { describe, it, expect, beforeEach } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { createTestDb, makeRun } from "../helpers/db";
import type { Database } from "#/db/client";
import {
  tasks,
  userStories,
  taskUserStories,
  outOfScopeItems,
  activityLog,
  taskPrototypePages,
} from "#/db/schema";
import { generateId } from "#/shared/utils";
import { addPage, addVariant, addVersion, createPrototype } from "#/modules/prds/prototypes";
import {
  createProject,
  addWorkspace,
  createPrd,
  createTask,
  deleteTask,
  getTask,
  triageTask,
  listActivityForTask,
  listActivityForRevision,
} from "#/lib/workflow";

/**
 * Regression for the bterm report: `depot task delete` failed with
 * `FOREIGN KEY constraint failed` even for pending, unlinked tasks. The cause
 * was the `task_created` audit row that every created task carries — a NO
 * ACTION foreign key from `activity_log.task_id` blocks the delete. The fix
 * clears the referencing rows (audit log, story links, out-of-scope
 * back-reference) in one transaction before removing the task.
 */

let db: Database;
let run: ReturnType<typeof makeRun>;
let projectId: string;
let prdRevisionId: string;

beforeEach(async () => {
  const result = createTestDb();
  db = result.db;
  run = makeRun(db);
  const project = await createProject(db, { name: "delete-app" });
  projectId = project.id;
  await addWorkspace(db, { projectId: project.id, path: "/home/user/delete-app" });
  const prd = await createPrd(db, { projectId: project.id, title: "Delete PRD" });
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

describe("deleteTask FK cleanup (bterm regression)", () => {
  it("deletes a pending task whose only reference is its task_created audit row", async () => {
    const task = await seedTask("Rough draft");
    // The create path always logs an audit event referencing the task.
    expect((await listActivityForTask(db, task.id)).length).toBeGreaterThan(0);

    const deleted = await deleteTask(db, task.id);
    expect(deleted.id).toBe(task.id);
    expect(await getTask(db, task.id)).toBeNull();

    // Audit rows for the task are gone (no dangling task_id) ...
    expect(await listActivityForTask(db, task.id)).toEqual([]);
    // ... and the removal itself is recorded on the revision.
    const revActivity = await listActivityForRevision(db, prdRevisionId);
    expect(revActivity.some((a) => a.eventType === "task_deleted")).toBe(true);
  });

  it("clears multiple audit rows (e.g. after a triage) in one transaction", async () => {
    const task = await seedTask("Triaged then deleted");
    await triageTask(db, task.id, "needs-info", { reason: "unclear" });
    expect((await listActivityForTask(db, task.id)).length).toBeGreaterThanOrEqual(2);

    await deleteTask(db, task.id);
    expect(await getTask(db, task.id)).toBeNull();
    expect(await db.select().from(activityLog).where(eq(activityLog.taskId, task.id))).toEqual([]);
  });

  it("clears story links and nulls an out-of-scope back-reference, leaving the story intact", async () => {
    const task = await seedTask("Linked task");

    const storyId = generateId();
    await db
      .insert(userStories)
      .values({ id: storyId, prdRevisionId, asRole: "user", want: "thing", so: "benefit" });
    await db.insert(taskUserStories).values({ taskId: task.id, userStoryId: storyId });

    const oosId = generateId();
    await db.insert(outOfScopeItems).values({
      id: oosId,
      projectId,
      prdRevisionId,
      title: "Not now",
      reason: "later",
      linkedReviewTaskId: task.id,
    });

    await deleteTask(db, task.id);

    expect(await getTask(db, task.id)).toBeNull();
    expect(
      await db.select().from(taskUserStories).where(eq(taskUserStories.taskId, task.id)),
    ).toEqual([]);
    const oos = (await db.select().from(outOfScopeItems).where(eq(outOfScopeItems.id, oosId)))[0];
    expect(oos?.linkedReviewTaskId).toBeNull();
    const story = (await db.select().from(userStories).where(eq(userStories.id, storyId)))[0];
    expect(story).toBeDefined();
  });

  it("clears prototype page links before deleting a pending task", async () => {
    const task = await seedTask("Linked prototype page");
    const proto = await run(createPrototype({ prdRevisionId, slug: "prototype" }));
    const page = await run(addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    const version = await run(addVersion({ pageId: page.id, label: "v1" }));
    await run(
      addVariant({ pageVersionId: version.id, label: "main", title: "Main", htmlContent: "<p/>" }),
    );
    await db.insert(taskPrototypePages).values({ taskId: task.id, pageId: page.id });

    await deleteTask(db, task.id);

    expect(await getTask(db, task.id)).toBeNull();
    expect(
      await db.select().from(taskPrototypePages).where(eq(taskPrototypePages.taskId, task.id)),
    ).toEqual([]);
  });

  it("still refuses to delete a task that is not pending", async () => {
    const task = await seedTask("In motion");
    await db.update(tasks).set({ status: "in_progress" }).where(eq(tasks.id, task.id));
    await expect(deleteTask(db, task.id)).rejects.toThrow(/only 'pending' is allowed/);
  });
});
