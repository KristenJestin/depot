import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createTestDb, makeRun } from "../helpers/db";
import { createProject } from "#/modules/projects/domain";
import { addRepo } from "#/modules/projects/repos";
import { createPrd } from "#/modules/prds/domain";
import { addPrdRepo } from "#/modules/prds/repos";
import { createTask, startTask } from "#/modules/tasks/domain";
import { logActivity, listActivity } from "#/modules/activity/domain";
import { activityLog } from "#/db/schema";
import type { Database } from "#/db/client";

describe("activity_log.repoName attribution (PRD 0006 / 02)", () => {
  let db: Database;
  let run: ReturnType<typeof makeRun>;
  let projectId: string;

  beforeEach(async () => {
    db = createTestDb().db;
    run = makeRun(db);
    projectId = (await run(createProject({ name: "main" }))).id;
  });

  describe("schema", () => {
    it("activity_log carries a nullable repo_name column", async () => {
      const cols = (db.$client as unknown as { prepare: (sql: string) => { all: () => unknown[] } })
        .prepare("PRAGMA table_info('activity_log')")
        .all() as Array<{ name: string; notnull: number }>;
      const repoCol = cols.find((c) => c.name === "repo_name");
      expect(repoCol).toBeDefined();
      expect(repoCol!.notnull).toBe(0);
    });
  });

  describe("logActivity — explicit repoName", () => {
    it("persists the explicit repoName when provided", async () => {
      const prd = await run(createPrd({ projectId, title: "X" }));
      const entry = await run(
        logActivity({
          projectId,
          prdRevisionId: prd.id,
          eventType: "git_commit",
          payload: { sha: "abc123", message: "feat", filesChanged: 1, repo: "api" },
          repoName: "api",
        }),
      );
      expect(entry.repoName).toBe("api");
    });

    it("defaults repoName to null when not provided (mono-repo / generic)", async () => {
      const entry = await run(
        logActivity({
          projectId,
          eventType: "note",
          payload: { message: "hello" },
        }),
      );
      expect(entry.repoName).toBeNull();
    });
  });

  describe("logActivity — auto-resolve from task.repoId", () => {
    it("derives repoName from task.repoId when a task is referenced", async () => {
      const prd = await run(createPrd({ projectId, title: "X" }));
      const repo = await run(addRepo({ projectId, name: "front", path: "/tmp/front" }));
      await run(addPrdRepo(prd.id, repo.id));
      const task = await run(
        createTask({
          prdRevisionId: prd.id,
          title: "t",
          description: "d",
          doneCriteria: "ok",
          effort: "s",
          repoId: repo.id,
        }),
      );

      // Read the auto-logged task_created entry rather than re-logging.
      const created = (await run(listActivity({ projectId }))).find(
        (e) => e.eventType === "task_created" && e.taskId === task.id,
      );
      expect(created).toBeDefined();
      expect(created!.repoName).toBe("front");
    });

    it("leaves repoName null when the task has no repoId", async () => {
      const prd = await run(createPrd({ projectId, title: "X" }));
      const task = await run(
        createTask({
          prdRevisionId: prd.id,
          title: "t",
          description: "d",
          doneCriteria: "ok",
          effort: "s",
        }),
      );
      const created = (await run(listActivity({ projectId }))).find(
        (e) => e.eventType === "task_created" && e.taskId === task.id,
      );
      expect(created).toBeDefined();
      expect(created!.repoName).toBeNull();
    });

    it("an explicit repoName overrides the task-derived one", async () => {
      const prd = await run(createPrd({ projectId, title: "X" }));
      const repoA = await run(addRepo({ projectId, name: "api", path: "/tmp/api" }));
      const repoB = await run(addRepo({ projectId, name: "front", path: "/tmp/front" }));
      await run(addPrdRepo(prd.id, repoA.id));
      await run(addPrdRepo(prd.id, repoB.id));
      const task = await run(
        createTask({
          prdRevisionId: prd.id,
          title: "t",
          description: "d",
          doneCriteria: "ok",
          effort: "s",
          repoId: repoA.id,
        }),
      );

      const entry = await run(
        logActivity({
          projectId,
          prdRevisionId: prd.id,
          taskId: task.id,
          eventType: "note",
          payload: { message: "manual override" },
          repoName: "front",
        }),
      );
      expect(entry.repoName).toBe("front");
    });
  });

  describe("listActivity — filter by repo", () => {
    it("filters by repoName when supplied", async () => {
      const prd = await run(createPrd({ projectId, title: "X" }));
      await run(
        logActivity({
          projectId,
          prdRevisionId: prd.id,
          eventType: "note",
          payload: { message: "api-side" },
          repoName: "api",
        }),
      );
      await run(
        logActivity({
          projectId,
          prdRevisionId: prd.id,
          eventType: "note",
          payload: { message: "front-side" },
          repoName: "front",
        }),
      );
      await run(
        logActivity({
          projectId,
          prdRevisionId: prd.id,
          eventType: "note",
          payload: { message: "no-repo" },
        }),
      );

      const apiOnly = await run(listActivity({ projectId, repoName: "api" }));
      expect(apiOnly).toHaveLength(1);
      expect(JSON.parse(apiOnly[0]!.payload).message).toBe("api-side");

      const frontOnly = await run(listActivity({ projectId, repoName: "front" }));
      expect(frontOnly).toHaveLength(1);

      // Note: createPrd auto-logs a 'prd_created' event with null repoName, so
      // the unfiltered list includes 3 explicit notes + 1 auto-logged creation.
      const all = await run(listActivity({ projectId }));
      const noteRows = all.filter((r) => r.eventType === "note");
      expect(noteRows).toHaveLength(3);
    });

    it("historical rows (repoName null) are skipped by a repo filter", async () => {
      // Simulate a pre-migration row by inserting one directly with no repoName.
      await db.insert(activityLog).values({
        id: "hist-1",
        projectId,
        eventType: "note",
        payload: JSON.stringify({ message: "legacy" }),
        repoName: null,
      });
      const filtered = await run(listActivity({ projectId, repoName: "api" }));
      expect(filtered).toHaveLength(0);

      const unfiltered = await run(listActivity({ projectId }));
      expect(unfiltered).toHaveLength(1);
      expect(unfiltered[0]!.repoName).toBeNull();
    });
  });

  describe("auto-resolved repoName on task lifecycle events", () => {
    it("task_started carries the task's repoName", async () => {
      const prd = await run(createPrd({ projectId, title: "X" }));
      const repo = await run(addRepo({ projectId, name: "worker", path: "/tmp/worker" }));
      await run(addPrdRepo(prd.id, repo.id));
      const task = await run(
        createTask({
          prdRevisionId: prd.id,
          title: "t",
          description: "d",
          doneCriteria: "ok",
          effort: "s",
          repoId: repo.id,
        }),
      );
      await run(startTask(task.id));
      const started = (await run(listActivity({ projectId }))).find(
        (e) => e.eventType === "task_started" && e.taskId === task.id,
      );
      expect(started).toBeDefined();
      expect(started!.repoName).toBe("worker");
    });
  });
});
