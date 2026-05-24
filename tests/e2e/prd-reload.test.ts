import { describe, expect, it } from "vite-plus/test";
import * as Projects from "#/modules/projects/domain";
import * as Prds from "#/modules/prds/domain";
import * as Tasks from "#/modules/tasks/domain";
import { runE } from "./helpers";

describe("e2e prd reload", () => {
  it("preserves prd id and replaces tasks", async () => {
    const project = await runE(Projects.createProject({ name: "e2e-prd-reload" }));

    const { prd } = await runE(
      Prds.loadPrdBatch({
        projectId: project.id,
        title: "Reload PRD",
        ready: false,
        tasks: [
          {
            title: "Old Task 1",
            description: "Old Desc 1",
            doneCriteria: "Old Done 1",
            effort: "s",
            dependsOn: [],
          },
          {
            title: "Old Task 2",
            description: "Old Desc 2",
            doneCriteria: "Old Done 2",
            effort: "m",
            dependsOn: [0],
          },
        ],
      }),
    );

    const reloaded = await runE(
      Prds.reloadPrdBatch({
        prdRevisionId: prd.id,
        title: "Reloaded PRD",
        tasks: [
          {
            title: "New Task 1",
            description: "New Desc 1",
            doneCriteria: "New Done 1",
            effort: "s",
            dependsOn: [],
          },
          {
            title: "New Task 2",
            description: "New Desc 2",
            doneCriteria: "New Done 2",
            effort: "s",
            dependsOn: [0],
          },
          {
            title: "New Task 3",
            description: "New Desc 3",
            doneCriteria: "New Done 3",
            effort: "m",
            dependsOn: [1],
          },
        ],
      }),
    );

    expect(reloaded.prd.id).toBe(prd.id);
    expect(reloaded.prd.status).toBe("draft");

    const tasks = await runE(Tasks.listTasks(prd.id, { prdTasksOnly: true }));
    expect(tasks).toHaveLength(3);
    expect(tasks.map((task) => task.title)).toEqual(["New Task 1", "New Task 2", "New Task 3"]);
  });
});
