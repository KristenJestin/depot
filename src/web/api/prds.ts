import { Hono } from "hono";

import { getRuntime } from "#/services/database";
import * as DomainPrds from "#/modules/prds/domain";
import * as DomainTasks from "#/modules/tasks/domain";
import * as DomainReviews from "#/modules/reviews/domain";
import * as DomainActivity from "#/modules/activity/domain";
import type { Variables } from "./types";

export const prdsRoutes = new Hono<{ Variables: Variables }>()
  .get("/prds", async (c) => {
    const db = c.var.db;
    const prdList = await getRuntime().runPromise(DomainPrds.listPrds({ latestOnly: true }));
    prdList.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    const allTaskRows = await db.query.tasks.findMany({
      columns: { prdId: true, status: true, reviewId: true },
    });
    const taskRows = allTaskRows.filter((t) => t.reviewId === null);

    const taskCounts = new Map<string, { total: number; done: number }>();
    for (const task of taskRows) {
      const entry = taskCounts.get(task.prdId) ?? { total: 0, done: 0 };
      entry.total++;
      if (task.status === "done" || task.status === "skipped") entry.done++;
      taskCounts.set(task.prdId, entry);
    }

    const prds = prdList.map((p) => {
      const counts = taskCounts.get(p.id) ?? { total: 0, done: 0 };
      return { ...p, totalTasks: counts.total, doneTasks: counts.done };
    });

    return c.json({ prds }, 200);
  })
  .get("/prds/:id", async (c) => {
    const { id } = c.req.param();

    const prd = await getRuntime().runPromise(DomainPrds.getPrd(id));
    if (!prd) return c.json({ error: "Not found" }, 404);

    const tasks = await getRuntime().runPromise(DomainTasks.listTasks(id, { prdTasksOnly: true }));
    const latestReview = await getRuntime().runPromise(DomainReviews.getLatestReview(id));
    const findings = latestReview
      ? await getRuntime().runPromise(DomainReviews.listReviewTasks(latestReview.id))
      : [];

    const review = latestReview
      ? { id: latestReview.id, type: latestReview.type, status: latestReview.status, findings }
      : null;

    const revisions = await getRuntime().runPromise(DomainPrds.listPrdFamily(prd.rootId ?? prd.id));

    return c.json({ prd, tasks, review, revisions }, 200);
  })
  .get("/prds/:id/tasks/:taskId", async (c) => {
    const { id, taskId } = c.req.param();

    const prd = await getRuntime().runPromise(DomainPrds.getPrd(id));
    if (!prd) return c.json({ error: "Not found" }, 404);

    const task = await getRuntime().runPromise(DomainTasks.getTask(taskId));
    if (!task || task.prdId !== id) return c.json({ error: "Not found" }, 404);

    const logs = await getRuntime().runPromise(DomainActivity.listActivityForTask(taskId));

    const lines: { text: string; type: "command" | "output" }[] = [];
    const files: { path: string; added: number; removed: number }[] = [];

    for (const log of logs) {
      const payload = JSON.parse(log.payload) as Record<string, unknown>;
      if (log.eventType === "note" && payload.kind === "terminal" && Array.isArray(payload.lines)) {
        lines.push(...(payload.lines as { text: string; type: "command" | "output" }[]));
      } else if (log.eventType === "task_done" && Array.isArray(payload.files)) {
        files.push(...(payload.files as { path: string; added: number; removed: number }[]));
      }
    }

    return c.json({ task, prd: { id: prd.id, title: prd.title }, activity: { lines, files } }, 200);
  })
  .get("/prds/:id/reviews/:reviewId", async (c) => {
    const { id, reviewId } = c.req.param();

    const prd = await getRuntime().runPromise(DomainPrds.getPrd(id));
    if (!prd) return c.json({ error: "Not found" }, 404);

    const review = await getRuntime().runPromise(DomainReviews.getReview(reviewId));
    if (!review || review.prdId !== id) return c.json({ error: "Not found" }, 404);

    const findings = await getRuntime().runPromise(DomainReviews.listReviewTasks(reviewId));

    return c.json(
      { review, prd: { id: prd.id, title: prd.title, status: prd.status }, findings },
      200,
    );
  });
