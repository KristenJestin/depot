import { Effect } from "effect";
import { and, eq } from "drizzle-orm";
import { taskPrototypePages } from "#/db/schema";
import { Db } from "#/services/database";
import { dbQuery } from "#/shared/db";
import { assertTaskInPrd } from "#/lib/cross-entity";
import { getPage, getPrototype } from "#/modules/prds/prototypes";

/**
 * Page ↔ task link domain (PRD 0030 / issue 04).
 *
 * The M:N join `task_prototype_pages` — "this task realises these pages" —
 * modeled on `task_user_stories` (`stories.ts`). The schema cannot express the
 * one invariant that matters: a task and a page may only be linked when they
 * belong to the **same PRD revision** (the task via `task.prdRevisionId`, the
 * page via its prototype's `prdRevisionId`). `assertTaskInPrd` enforces it,
 * failing with `CrossEntityError` when they diverge — the same guard
 * `linkStoryToTask` uses.
 */

/**
 * Resolve the PRD revision a page belongs to via its prototype. Fails with
 * `PrototypePageNotFoundError` / `PrototypeNotFoundError` when either is gone.
 */
const pagePrdRevisionId = (pageId: string) =>
  Effect.gen(function* () {
    const page = yield* getPage(pageId);
    const prototype = yield* getPrototype(page.prototypeId);
    return prototype.prdRevisionId;
  });

export const linkTaskPage = (taskId: string, pageId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const prdRevisionId = yield* pagePrdRevisionId(pageId);
    yield* assertTaskInPrd(taskId, prdRevisionId);

    const existing = yield* dbQuery(() =>
      db.query.taskPrototypePages.findFirst({ where: { taskId, pageId } }),
    );
    if (existing) return existing;

    const rows = yield* dbQuery(() =>
      db.insert(taskPrototypePages).values({ taskId, pageId }).returning(),
    );
    return rows[0]!;
  });

export const unlinkTaskPage = (taskId: string, pageId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    yield* dbQuery(() =>
      db
        .delete(taskPrototypePages)
        .where(and(eq(taskPrototypePages.taskId, taskId), eq(taskPrototypePages.pageId, pageId))!),
    );
    return { taskId, pageId };
  });

export const listTaskPages = (taskId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const links = yield* dbQuery(() => db.query.taskPrototypePages.findMany({ where: { taskId } }));
    if (links.length === 0) return [];
    return yield* dbQuery(() =>
      db.query.prdPrototypePages.findMany({
        where: { id: { in: links.map((l) => l.pageId) } },
      }),
    );
  });

export const listPageTasks = (pageId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const links = yield* dbQuery(() => db.query.taskPrototypePages.findMany({ where: { pageId } }));
    if (links.length === 0) return [];
    return yield* dbQuery(() =>
      db.query.tasks.findMany({ where: { id: { in: links.map((l) => l.taskId) } } }),
    );
  });
