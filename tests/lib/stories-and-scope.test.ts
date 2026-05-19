import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, makeRun } from "../helpers/db";
import {
  createUserStory,
  listUserStories,
  updateUserStory,
  removeUserStory,
  linkStoryToTask,
  unlinkStoryFromTask,
  listStoriesForTask,
} from "#/modules/prds/stories";
import { addOutOfScope, listOutOfScope, removeOutOfScope } from "#/modules/prds/out-of-scope";
import { createPrd, updatePrdSections } from "#/modules/prds/domain";
import { createTask } from "#/modules/tasks/domain";
import { createProject } from "#/modules/projects/domain";
import type { Database } from "#/db/client";

describe("user stories", () => {
  let db: Database;
  let run: ReturnType<typeof makeRun>;
  let projectId: string;
  let prdRevisionId: string;

  beforeEach(async () => {
    db = createTestDb().db;
    run = makeRun(db);
    const project = await run(createProject({ name: "test" }));
    projectId = project.id;
    const prd = await run(
      createPrd({ projectId, title: "PRD with stories", context: "ctx", scope: "scope" }),
    );
    prdRevisionId = prd.id;
  });

  it("creates and lists stories in position order", async () => {
    await run(createUserStory({ prdRevisionId, asRole: "user", want: "X", so: "Y" }));
    await run(createUserStory({ prdRevisionId, asRole: "admin", want: "A", so: "B" }));
    const list = await run(listUserStories(prdRevisionId));
    expect(list).toHaveLength(2);
    expect(list[0]?.position).toBe(1);
    expect(list[1]?.position).toBe(2);
  });

  it("updates a story", async () => {
    const s = await run(createUserStory({ prdRevisionId, asRole: "user", want: "X", so: "Y" }));
    const updated = await run(updateUserStory(s.id, { want: "X (updated)" }));
    expect(updated.want).toBe("X (updated)");
  });

  it("links a story to a task and lists them", async () => {
    const s = await run(createUserStory({ prdRevisionId, asRole: "user", want: "X", so: "Y" }));
    const t = await run(
      createTask({
        prdRevisionId,
        title: "Task A",
        description: "Intent: …",
        doneCriteria: "Works",
        effort: "s",
      }),
    );
    await run(linkStoryToTask(s.id, t.id));
    const linked = await run(listStoriesForTask(t.id));
    expect(linked).toHaveLength(1);
    expect(linked[0]?.id).toBe(s.id);
  });

  it("unlinks a story from a task", async () => {
    const s = await run(createUserStory({ prdRevisionId, asRole: "user", want: "X", so: "Y" }));
    const t = await run(
      createTask({
        prdRevisionId,
        title: "Task A",
        description: "Intent: …",
        doneCriteria: "Works",
        effort: "s",
      }),
    );
    await run(linkStoryToTask(s.id, t.id));
    await run(unlinkStoryFromTask(s.id, t.id));
    const linked = await run(listStoriesForTask(t.id));
    expect(linked).toHaveLength(0);
  });

  it("removeUserStory removes its links too", async () => {
    const s = await run(createUserStory({ prdRevisionId, asRole: "user", want: "X", so: "Y" }));
    const t = await run(
      createTask({
        prdRevisionId,
        title: "Task A",
        description: "Intent: …",
        doneCriteria: "Works",
        effort: "s",
      }),
    );
    await run(linkStoryToTask(s.id, t.id));
    await run(removeUserStory(s.id));
    const linked = await run(listStoriesForTask(t.id));
    expect(linked).toHaveLength(0);
  });

  it("updatePrdSections writes the structured fields", async () => {
    const updated = await run(
      updatePrdSections(prdRevisionId, {
        problem: "Users can't X",
        solution: "Add Y",
        implementationDecisions: "Use Z",
        testingDecisions: "Unit + E2E",
      }),
    );
    expect(updated.problem).toBe("Users can't X");
    expect(updated.solution).toBe("Add Y");
    expect(updated.implementationDecisions).toBe("Use Z");
    expect(updated.testingDecisions).toBe("Unit + E2E");
  });
});

describe("out-of-scope items", () => {
  let db: Database;
  let run: ReturnType<typeof makeRun>;
  let projectId: string;
  let prdRevisionId: string;

  beforeEach(async () => {
    db = createTestDb().db;
    run = makeRun(db);
    const project = await run(createProject({ name: "test" }));
    projectId = project.id;
    const prd = await run(createPrd({ projectId, title: "PRD", context: "ctx", scope: "scope" }));
    prdRevisionId = prd.id;
  });

  it("adds and lists out-of-scope items", async () => {
    await run(
      addOutOfScope({
        projectId,
        prdRevisionId,
        title: "Multi-tenancy",
        reason: "Defer to v2",
      }),
    );
    await run(
      addOutOfScope({
        projectId,
        title: "Mobile app",
        reason: "Project-wide no",
      }),
    );
    const all = await run(listOutOfScope({ projectId }));
    expect(all).toHaveLength(2);
    const prdScoped = await run(listOutOfScope({ projectId, prdRevisionId }));
    expect(prdScoped).toHaveLength(1);
    expect(prdScoped[0]?.title).toBe("Multi-tenancy");
  });

  it("removes an out-of-scope item", async () => {
    const item = await run(addOutOfScope({ projectId, title: "X", reason: "Y" }));
    await run(removeOutOfScope(item.id));
    const remaining = await run(listOutOfScope({ projectId }));
    expect(remaining).toHaveLength(0);
  });
});
