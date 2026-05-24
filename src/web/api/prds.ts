import { Hono } from "hono";
import { asc, inArray } from "drizzle-orm";

import { reviews, tasks } from "#/db/schema";
import { getRuntime } from "#/services/database";
import * as DomainPrds from "#/modules/prds/domain";
import * as DomainTasks from "#/modules/tasks/domain";
import * as DomainReviews from "#/modules/reviews/domain";
import * as DomainActivity from "#/modules/activity/domain";
import * as DomainPrdRepos from "#/modules/prds/repos";
import * as DomainProjectRepos from "#/modules/projects/repos";
import type { Variables } from "./types";

export const prdsRoutes = new Hono<{ Variables: Variables }>()
  .get("/prds", async (c) => {
    const db = c.var.db;
    // Scope the dashboard to the project of the currently-selected workspace.
    // The workspace cookie set via PATCH /api/context is the source of truth;
    // when no cookie is set, the middleware falls back to a cwd-based hint
    // (see src/web/api/index.ts). When no workspace can be resolved at all
    // we still list all PRDs so a fresh install isn't a blank page.
    const wsId = c.var.currentWorkspaceId;
    let projectId: string | null = null;
    if (wsId) {
      const ws = await db.query.workspaces.findFirst({
        where: { id: wsId },
        columns: { projectId: true },
      });
      projectId = ws?.projectId ?? null;
    }
    const prdList = await getRuntime().runPromise(
      DomainPrds.listPrds(projectId ? { projectId, latestOnly: true } : { latestOnly: true }),
    );
    prdList.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    const prdRevisionIds = prdList.map((prd) => prd.id);
    const allTaskRows =
      prdRevisionIds.length === 0
        ? []
        : await db
            .select({
              id: tasks.id,
              prdRevisionId: tasks.prdRevisionId,
              title: tasks.title,
              position: tasks.position,
              status: tasks.status,
              reviewId: tasks.reviewId,
              severity: tasks.severity,
            })
            .from(tasks)
            .where(inArray(tasks.prdRevisionId, prdRevisionIds))
            .orderBy(asc(tasks.position));
    const reviewRows =
      prdRevisionIds.length === 0
        ? []
        : await db
            .select({
              id: reviews.id,
              prdRevisionId: reviews.prdRevisionId,
              type: reviews.type,
              status: reviews.status,
              createdAt: reviews.createdAt,
              doneAt: reviews.doneAt,
            })
            .from(reviews)
            .where(inArray(reviews.prdRevisionId, prdRevisionIds))
            .orderBy(asc(reviews.createdAt));

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

    // Project names — needed so the UI can show a project badge on the
    // PRD card when the dashboard is in "all projects" mode (workspace
    // switcher set to null). One batched query keeps it cheap; the
    // result lives in a Map keyed on projectId.
    const distinctProjectIds = [...new Set(prdList.map((p) => p.projectId))];
    const projectNameMap = new Map<string, string>();
    if (distinctProjectIds.length > 0) {
      const projectRows = await db.query.projects.findMany({
        columns: { id: true, name: true },
      });
      for (const row of projectRows) {
        if (distinctProjectIds.includes(row.id)) projectNameMap.set(row.id, row.name);
      }
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
        projectName: projectNameMap.get(p.projectId) ?? null,
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
      repoName: a.repoName,
      source: a.source,
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
  .patch("/prds/:id/tasks/:taskId", async (c) => {
    const { id, taskId } = c.req.param();
    const prd = await getRuntime().runPromise(DomainPrds.getPrd(id));
    if (!prd) return c.json({ error: "Not found" }, 404);

    const existing = await getRuntime().runPromise(DomainTasks.getTask(taskId));
    if (!existing || existing.prdRevisionId !== id) return c.json({ error: "Not found" }, 404);

    type Body = { repoId?: string | null };
    const body = (await c.req.json().catch(() => ({}))) as Body;

    if (body.repoId !== undefined && body.repoId !== null && typeof body.repoId !== "string") {
      return c.json({ error: "repoId must be a string or null" }, 422);
    }

    // The web `PATCH /tasks` surface is repo-only for now (issue 0005/02) — other
    // task edits are out of scope here. Refuse early when nothing actionable was
    // sent rather than letting the domain return "No task changes provided".
    if (body.repoId === undefined) {
      return c.json({ error: "repoId is required" }, 422);
    }

    try {
      const task = await getRuntime().runPromise(
        DomainTasks.updateTask(taskId, { repoId: body.repoId }),
      );
      return c.json({ task }, 200);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 422);
    }
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
  })
  .get("/prds/:id/repos", async (c) => {
    const { id } = c.req.param();
    const prd = await getRuntime().runPromise(DomainPrds.getPrd(id));
    if (!prd) return c.json({ error: "Not found" }, 404);

    const links = await getRuntime().runPromise(DomainPrdRepos.listPrdRepos(prd.id));
    const projectReposList = await getRuntime().runPromise(
      DomainProjectRepos.listRepos(prd.projectId),
    );
    const repoById = new Map(projectReposList.map((r) => [r.id, r]));
    const items = links
      .map((link) => {
        const repo = repoById.get(link.repoId);
        if (!repo) return null;
        return {
          id: repo.id,
          name: repo.name,
          path: repo.path,
          isPrimary: repo.isPrimary,
          baseBranch: repo.baseBranch,
          linkId: link.id,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    return c.json(
      {
        items,
        projectRepos: projectReposList.map((r) => ({
          id: r.id,
          name: r.name,
          path: r.path,
          isPrimary: r.isPrimary,
          baseBranch: r.baseBranch,
        })),
        implicit: projectReposList.length === 0,
      },
      200,
    );
  })
  .post("/prds/:id/repos", async (c) => {
    const { id } = c.req.param();
    const prd = await getRuntime().runPromise(DomainPrds.getPrd(id));
    if (!prd) return c.json({ error: "Not found" }, 404);

    type Body = { repoName?: string };
    const body = (await c.req.json().catch(() => ({}))) as Body;
    if (!body.repoName || typeof body.repoName !== "string") {
      return c.json({ error: "repoName is required" }, 422);
    }

    const repo = await getRuntime().runPromise(
      DomainProjectRepos.getRepo(prd.projectId, body.repoName),
    );
    if (!repo) {
      return c.json({ error: `Repo '${body.repoName}' is not registered for this project.` }, 422);
    }

    try {
      const item = await getRuntime().runPromise(DomainPrdRepos.addPrdRepo(prd.id, repo.id));
      return c.json({ item }, 201);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 422);
    }
  })
  .delete("/prds/:id/repos/:repoName", async (c) => {
    const { id, repoName } = c.req.param();
    const prd = await getRuntime().runPromise(DomainPrds.getPrd(id));
    if (!prd) return c.json({ error: "Not found" }, 404);

    const repo = await getRuntime().runPromise(DomainProjectRepos.getRepo(prd.projectId, repoName));
    if (!repo) {
      return c.json({ error: `Repo '${repoName}' is not registered for this project.` }, 422);
    }

    await getRuntime().runPromise(DomainPrdRepos.removePrdRepo(prd.id, repo.id));
    return c.json({ prdRevisionId: prd.id, repoId: repo.id }, 200);
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
