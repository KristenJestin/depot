import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createTestDb, makeRun } from "../helpers/db";
import {
  linkTaskPage,
  unlinkTaskPage,
  listTaskPages,
  listPageTasks,
} from "#/modules/prds/task-pages";
import { addPage, createPrototype } from "#/modules/prds/prototypes";
import { createPrd, forkPrd } from "#/modules/prds/domain";
import { createTask } from "#/modules/tasks/domain";
import { createProject } from "#/modules/projects/domain";
import type { Database } from "#/db/client";

/**
 * Page ↔ task link domain (PRD 0030 / issue 04). Modeled on the
 * `task_user_stories` coverage in `stories-and-scope.test.ts`: link both ways,
 * idempotence, same-PRD validation, and fork survival.
 */
describe("task ↔ page links (PRD 0030 / 04)", () => {
  let db: Database;
  let run: ReturnType<typeof makeRun>;
  let projectId: string;
  let prdRevisionId: string;

  const makeTask = (title: string) =>
    run(
      createTask({
        prdRevisionId,
        title,
        description: "Intent: …",
        doneCriteria: "Works",
        effort: "s",
      }),
    );

  const makePage = async (protoSlug: string, pageSlug: string) => {
    const proto = await run(createPrototype({ prdRevisionId, slug: protoSlug }));
    return run(addPage({ prototypeId: proto.id, slug: pageSlug, title: pageSlug }));
  };

  beforeEach(async () => {
    db = createTestDb().db;
    run = makeRun(db);
    projectId = (await run(createProject({ name: "p" }))).id;
    prdRevisionId = (await run(createPrd({ projectId, title: "X" }))).id;
  });

  it("links a page to a task and lists it both ways", async () => {
    const task = await makeTask("T");
    const page = await makePage("proto", "home");

    await run(linkTaskPage(task.id, page.id));

    const pages = await run(listTaskPages(task.id));
    expect(pages.map((p) => p.id)).toEqual([page.id]);

    const tasks = await run(listPageTasks(page.id));
    expect(tasks.map((t) => t.id)).toEqual([task.id]);
  });

  it("links one page to several tasks", async () => {
    const page = await makePage("proto", "home");
    const t1 = await makeTask("T1");
    const t2 = await makeTask("T2");

    await run(linkTaskPage(t1.id, page.id));
    await run(linkTaskPage(t2.id, page.id));

    const tasks = await run(listPageTasks(page.id));
    expect(tasks.map((t) => t.id).sort()).toEqual([t1.id, t2.id].sort());
  });

  it("links one task to several pages", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "proto" }));
    const home = await run(addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    const list = await run(addPage({ prototypeId: proto.id, slug: "list", title: "List" }));
    const task = await makeTask("T");

    await run(linkTaskPage(task.id, home.id));
    await run(linkTaskPage(task.id, list.id));

    const pages = await run(listTaskPages(task.id));
    expect(pages.map((p) => p.id).sort()).toEqual([home.id, list.id].sort());
  });

  it("is idempotent: linking twice keeps a single link", async () => {
    const task = await makeTask("T");
    const page = await makePage("proto", "home");

    const first = await run(linkTaskPage(task.id, page.id));
    const second = await run(linkTaskPage(task.id, page.id));
    expect(second).toEqual(first);

    const pages = await run(listTaskPages(task.id));
    expect(pages).toHaveLength(1);
  });

  it("unlink removes the link and is idempotent", async () => {
    const task = await makeTask("T");
    const page = await makePage("proto", "home");

    await run(linkTaskPage(task.id, page.id));
    await run(unlinkTaskPage(task.id, page.id));
    expect(await run(listTaskPages(task.id))).toHaveLength(0);

    // Unlinking again is a no-op, not an error.
    await run(unlinkTaskPage(task.id, page.id));
    expect(await run(listPageTasks(page.id))).toHaveLength(0);
  });

  it("refuses a cross-PRD link (task and page in different revisions)", async () => {
    const page = await makePage("proto", "home");

    const otherRev = (await run(createPrd({ projectId, title: "Y" }))).id;
    const otherTask = await run(
      createTask({
        prdRevisionId: otherRev,
        title: "Other",
        description: "Intent: …",
        doneCriteria: "Works",
        effort: "s",
      }),
    );

    await expect(run(linkTaskPage(otherTask.id, page.id))).rejects.toThrow(
      /does not belong to PRD/,
    );
    expect(await run(listPageTasks(page.id))).toHaveLength(0);
  });

  it("fails when the page does not exist", async () => {
    const task = await makeTask("T");
    await expect(run(linkTaskPage(task.id, "nope"))).rejects.toThrow(/Prototype page not found/);
  });

  it("fails when the task does not exist", async () => {
    const page = await makePage("proto", "home");
    await expect(run(linkTaskPage("nope", page.id))).rejects.toThrow(/Task not found/);
  });

  it("the link survives a PRD fork (both ids remapped)", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "proto" }));
    const page = await run(addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    const task = await makeTask("T");
    await run(linkTaskPage(task.id, page.id));

    // `forkPrd` requires a ready revision before it produces a draft fork.
    const { markPrdReady } = await import("#/modules/prds/domain");
    await run(markPrdReady(prdRevisionId));
    const forked = await run(forkPrd(prdRevisionId));

    // The forked task and page carry new ids…
    const forkedTask = (await db.query.tasks.findMany({ where: { prdRevisionId: forked.id } }))[0]!;
    expect(forkedTask.id).not.toBe(task.id);

    // …and the link between them was rebuilt onto the fork's own ids.
    const forkedPages = await run(listTaskPages(forkedTask.id));
    expect(forkedPages).toHaveLength(1);
    expect(forkedPages[0]!.id).not.toBe(page.id);
    expect(forkedPages[0]!.slug).toBe("home");

    // The original link is untouched on the source revision.
    const sourcePages = await run(listTaskPages(task.id));
    expect(sourcePages.map((p) => p.id)).toEqual([page.id]);
  });
});
