import { describe, expect, it } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { prdRevisions } from "#/db/schema";
import * as Projects from "#/modules/projects/domain";
import * as Prds from "#/modules/prds/domain";
import * as Tasks from "#/modules/tasks/domain";
import { getTestDb, runE } from "./helpers";

describe("e2e prd fork", () => {
  it("copies prd tasks and remaps dependencies", async () => {
    const project = await runE(Projects.createProject({ name: "e2e-prd-fork" }));
    const db = getTestDb();

    const { prd, tasks: sourceTasks } = await runE(
      Prds.loadPrdBatch({
        projectId: project.id,
        title: "Fork PRD",
        ready: true,
        tasks: [
          {
            title: "Task 1",
            description: "Desc 1",
            doneCriteria: "Done 1",
            effort: "s",
            dependsOn: [],
            phaseNumber: 1,
          },
          {
            title: "Task 2",
            description: "Desc 2",
            doneCriteria: "Done 2",
            effort: "m",
            dependsOn: [0],
            phaseNumber: 2,
          },
          {
            title: "Task 3",
            description: "Desc 3",
            doneCriteria: "Done 3",
            effort: "s",
            dependsOn: [1],
            phaseNumber: 2,
          },
        ],
      }),
    );

    await db.update(prdRevisions).set({ currentPhase: 2 }).where(eq(prdRevisions.id, prd.id));

    const forked = await runE(Prds.forkPrd(prd.id));
    const forkedPrd = await runE(Prds.getPrd(forked.id));
    expect(forked.status).toBe("draft");
    expect(forked.revision).toBe(2);
    expect(forked.currentPhase).toBe(2);
    expect(forkedPrd?.id).toBe(forked.id);

    const persistedPrd = await db.query.prds.findFirst({ where: { id: prd.prdId } });
    const sourceRevision = await db.query.prdRevisions.findFirst({ where: { id: prd.id } });
    const forkedRevision = await db.query.prdRevisions.findFirst({ where: { id: forked.id } });

    expect(persistedPrd?.currentRevisionId).toBe(forked.id);
    expect(sourceRevision?.supersededAt).toBeTruthy();
    expect(sourceRevision?.currentPhase).toBe(2);
    expect(forkedRevision?.currentPhase).toBe(2);

    const copiedTasks = await runE(Tasks.listTasks(forked.id, { prdTasksOnly: true }));

    expect(copiedTasks).toHaveLength(3);
    expect(copiedTasks.every((task) => task.status === "pending")).toBe(true);
    expect(copiedTasks.map((task) => task.phaseNumber)).toEqual([1, 2, 2]);

    const sourceIds = new Set(sourceTasks.map((task) => task.id));
    expect(copiedTasks.every((task) => !sourceIds.has(task.id))).toBe(true);

    const copiedDepsTask2: string[] = JSON.parse(copiedTasks[1]!.dependsOn);
    const copiedDepsTask3: string[] = JSON.parse(copiedTasks[2]!.dependsOn);
    expect(copiedDepsTask2).toEqual([copiedTasks[0]!.id]);
    expect(copiedDepsTask3).toEqual([copiedTasks[1]!.id]);
    expect(copiedDepsTask2).not.toContain(sourceTasks[0]!.id);
    expect(copiedDepsTask3).not.toContain(sourceTasks[1]!.id);
  });
});
