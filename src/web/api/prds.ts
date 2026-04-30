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
      columns: {
        id: true,
        prdRevisionId: true,
        title: true,
        position: true,
        status: true,
        reviewId: true,
        severity: true,
      },
      orderBy: { position: "asc" },
    });
    const reviewRows = await db.query.reviews.findMany({
      columns: {
        id: true,
        prdRevisionId: true,
        type: true,
        status: true,
        createdAt: true,
        doneAt: true,
      },
      orderBy: { createdAt: "asc" },
    });

    const taskCounts = new Map<
      string,
      {
        totalTasks: number;
        doneTasks: number;
        inProgressTasks: number;
        blockedTasks: number;
        skippedTasks: number;
      }
    >();
    const baseTaskMap = new Map<string, typeof allTaskRows>();
    const reviewTaskMap = new Map<string, typeof allTaskRows>();
    const reviewsByRevision = new Map<string, typeof reviewRows>();
    const reviewTaskCounts = new Map<
      string,
      {
        findingsCount: number;
        resolvedCount: number;
        activeCount: number;
        pendingCount: number;
        criticalCount: number;
        majorCount: number;
        minorCount: number;
        infoCount: number;
      }
    >();

    for (const review of reviewRows) {
      const entry = reviewsByRevision.get(review.prdRevisionId) ?? [];
      entry.push(review);
      reviewsByRevision.set(review.prdRevisionId, entry);
    }

    for (const task of allTaskRows) {
      if (task.reviewId === null) {
        const entry = taskCounts.get(task.prdRevisionId) ?? {
          totalTasks: 0,
          doneTasks: 0,
          inProgressTasks: 0,
          blockedTasks: 0,
          skippedTasks: 0,
        };

        entry.totalTasks++;
        if (task.status === "done" || task.status === "skipped") {
          entry.doneTasks++;
        }
        if (task.status === "in_progress") {
          entry.inProgressTasks++;
        }
        if (task.status === "blocked") {
          entry.blockedTasks++;
        }
        if (task.status === "skipped") {
          entry.skippedTasks++;
        }

        taskCounts.set(task.prdRevisionId, entry);
        const tasksForRevision = baseTaskMap.get(task.prdRevisionId) ?? [];
        tasksForRevision.push(task);
        baseTaskMap.set(task.prdRevisionId, tasksForRevision);
        continue;
      }

      const tasksForReview = reviewTaskMap.get(task.reviewId) ?? [];
      tasksForReview.push(task);
      reviewTaskMap.set(task.reviewId, tasksForReview);

      const entry = reviewTaskCounts.get(task.reviewId) ?? {
        findingsCount: 0,
        resolvedCount: 0,
        activeCount: 0,
        pendingCount: 0,
        criticalCount: 0,
        majorCount: 0,
        minorCount: 0,
        infoCount: 0,
      };

      entry.findingsCount++;

      if (task.status === "done" || task.status === "skipped") {
        entry.resolvedCount++;
      } else if (task.status === "in_progress" || task.status === "blocked") {
        entry.activeCount++;
      } else {
        entry.pendingCount++;
      }

      if (task.severity === "critical") {
        entry.criticalCount++;
      } else if (task.severity === "major") {
        entry.majorCount++;
      } else if (task.severity === "minor") {
        entry.minorCount++;
      } else if (task.severity === "info") {
        entry.infoCount++;
      }

      reviewTaskCounts.set(task.reviewId, entry);
    }

    const prds = prdList.map((p) => {
      const counts = taskCounts.get(p.id) ?? {
        totalTasks: 0,
        doneTasks: 0,
        inProgressTasks: 0,
        blockedTasks: 0,
        skippedTasks: 0,
      };
      const reviewsForRevision = reviewsByRevision.get(p.id) ?? [];
      const latestReviewRow = reviewsForRevision.at(-1) ?? null;
      const latestReviewWithOpenFindings = [...reviewsForRevision].reverse().find((review) => {
        const counts = reviewTaskCounts.get(review.id);
        return counts ? counts.activeCount + counts.pendingCount > 0 : false;
      });

      const latestReview = latestReviewRow
        ? {
            ...latestReviewRow,
            ...(reviewTaskCounts.get(latestReviewRow.id) ?? {
              findingsCount: 0,
              resolvedCount: 0,
              activeCount: 0,
              pendingCount: 0,
              criticalCount: 0,
              majorCount: 0,
              minorCount: 0,
              infoCount: 0,
            }),
          }
        : null;

      const previewTasksSource =
        p.status === "in_progress" && latestReviewWithOpenFindings
          ? (reviewTaskMap.get(latestReviewWithOpenFindings.id) ?? [])
          : (baseTaskMap.get(p.id) ?? []);

      const previewTasks = [...previewTasksSource]
        .sort((a, b) => compareTaskStatus(a.status, b.status) || a.position - b.position)
        .slice(0, 5)
        .map((task) => ({
          id: task.id,
          title: task.title,
          status: task.status,
        }));

      return {
        ...p,
        ...counts,
        latestReview,
        previewTasks,
      };
    });

    return c.json({ prds }, 200);
  })
  .get("/prds/:id", async (c) => {
    const { id } = c.req.param();

    const prd = await getRuntime().runPromise(DomainPrds.getPrd(id));
    if (!prd) return c.json({ error: "Not found" }, 404);

    const tasks = await getRuntime().runPromise(DomainTasks.listTasks(id, { prdTasksOnly: true }));
    const allReviews = await getRuntime().runPromise(DomainReviews.listReviews(id));

    const reviews = await Promise.all(
      allReviews.map(async (r) => {
        const findings = await getRuntime().runPromise(DomainReviews.listReviewTasks(r.id));
        return {
          id: r.id,
          type: r.type,
          status: r.status,
          phaseNumber: r.phaseNumber,
          createdAt: r.createdAt,
          doneAt: r.doneAt,
          userFeedback: r.userFeedback,
          findings,
        };
      }),
    );

    const revisions = await getRuntime().runPromise(DomainPrds.listPrdFamily(prd.prdId));
    const workspace = prd.workspaceId
      ? await c.var.db.query.workspaces.findFirst({
          where: { id: prd.workspaceId },
          columns: { id: true, path: true, label: true },
        })
      : null;

    const activityRows = await getRuntime().runPromise(
      DomainActivity.listActivityForRevision(prd.id),
    );
    const activity = activityRows.map((a) => ({
      id: a.id,
      eventType: a.eventType,
      payload: JSON.parse(a.payload) as Record<string, unknown>,
      taskId: a.taskId,
      createdAt: a.createdAt,
    }));

    return c.json({ prd, tasks, reviews, revisions, activity, workspace }, 200);
  })
  .get("/prds/:id/tasks/:taskId", async (c) => {
    const { id, taskId } = c.req.param();

    const prd = await getRuntime().runPromise(DomainPrds.getPrd(id));
    if (!prd) return c.json({ error: "Not found" }, 404);

    const task = await getRuntime().runPromise(DomainTasks.getTask(taskId));
    if (!task || task.prdRevisionId !== id) return c.json({ error: "Not found" }, 404);

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
    if (!review || review.prdRevisionId !== id) return c.json({ error: "Not found" }, 404);

    const findings = await getRuntime().runPromise(DomainReviews.listReviewTasks(reviewId));

    return c.json(
      { review, prd: { id: prd.id, title: prd.title, status: prd.status }, findings },
      200,
    );
  });

function compareTaskStatus(statusA: string, statusB: string): number {
  const order = {
    done: 0,
    skipped: 1,
    in_progress: 2,
    blocked: 3,
    pending: 4,
  } as const;

  return (
    (order[statusA as keyof typeof order] ?? 99) - (order[statusB as keyof typeof order] ?? 99)
  );
}
