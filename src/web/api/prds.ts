import { Hono } from "hono";
import { asc, inArray } from "drizzle-orm";

import { prdTags as prdTagsTable, prds as prdsTable, reviews, tasks } from "#/db/schema";
import { getRuntime } from "#/services/database";
import * as DomainPrds from "#/modules/prds/domain";
import * as DomainPriority from "#/modules/prds/priority";
import * as DomainTasks from "#/modules/tasks/domain";
import * as DomainReviews from "#/modules/reviews/domain";
import * as DomainActivity from "#/modules/activity/domain";
import * as DomainPrdRepos from "#/modules/prds/repos";
import * as DomainProjectRepos from "#/modules/projects/repos";
import * as DomainTags from "#/modules/prds/tags";
import * as DomainDependencies from "#/modules/prds/dependencies";
import * as DomainMilestones from "#/modules/prds/milestones";
import * as DomainAnnexes from "#/modules/prds/annexes";
import * as DomainIdeas from "#/modules/ideas/domain";
import { logActivity } from "#/modules/activity/domain";
import {
  invalidTagReason,
  isValidMilestone,
  isValidPrdPriority,
  isValidAnnexKind,
  MAX_MILESTONE_LENGTH,
  VALID_ANNEX_KINDS,
  VALID_PRD_PRIORITIES,
  type AnnexKind,
  type PrdPriority,
} from "#/shared/validator";
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
    let prdList = await getRuntime().runPromise(
      DomainPrds.listPrds(projectId ? { projectId, latestOnly: true } : { latestOnly: true }),
    );
    prdList.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    // Optional filters (PRD 0019 / T4): tag / milestone / dependsOn. They
    // apply on top of the workspace-scoped list and intersect when combined.
    const tagFilter = c.req.query("tag");
    const milestoneFilter = c.req.query("milestone");
    const dependsOnFilter = c.req.query("dependsOn") ?? c.req.query("depends_on");

    if (tagFilter && projectId) {
      const tagged = await getRuntime().runPromise(DomainTags.listPrdsForTag(projectId, tagFilter));
      const allowed = new Set(tagged.map((p) => p.id));
      prdList = prdList.filter((p) => allowed.has(p.id));
    }

    if (milestoneFilter && projectId) {
      const milestonePrds = await getRuntime().runPromise(
        DomainMilestones.listPrdsByMilestone(projectId, milestoneFilter),
      );
      const ids = new Set(milestonePrds.map((p) => p.id));
      prdList = prdList.filter((p) => ids.has(p.id));
    }

    if (dependsOnFilter) {
      const target = await getRuntime().runPromise(DomainPrds.getPrd(dependsOnFilter));
      const logicalTarget = target?.prdId ?? dependsOnFilter;
      const dependents = await getRuntime().runPromise(
        DomainDependencies.listDependents(logicalTarget),
      );
      const ids = new Set(dependents.map((d) => d.id));
      prdList = prdList.filter((p) => ids.has(p.prdId));
    }

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

    // Tags + target_version + priority per PRD (PRD 0019 T4 + T5). All three
    // live on the logical `prds` row so we look them up by `prdId`. One batched
    // query for tags + one for the logical PRDs keeps the list endpoint cheap.
    const distinctLogicalIds = [...new Set(prdList.map((p) => p.prdId))];
    const tagsByPrdId = new Map<string, string[]>();
    const targetVersionByPrdId = new Map<string, string | null>();
    const priorityByPrdId = new Map<string, PrdPriority>();
    if (distinctLogicalIds.length > 0) {
      const tagRows = await db
        .select({ prdId: prdTagsTable.prdId, tag: prdTagsTable.tag })
        .from(prdTagsTable)
        .where(inArray(prdTagsTable.prdId, distinctLogicalIds))
        .orderBy(asc(prdTagsTable.tag));
      for (const row of tagRows) {
        const list = tagsByPrdId.get(row.prdId) ?? [];
        list.push(row.tag);
        tagsByPrdId.set(row.prdId, list);
      }
      const logicalRows = await db
        .select({
          id: prdsTable.id,
          targetVersion: prdsTable.targetVersion,
          priority: prdsTable.priority,
        })
        .from(prdsTable)
        .where(inArray(prdsTable.id, distinctLogicalIds));
      for (const row of logicalRows) {
        targetVersionByPrdId.set(row.id, row.targetVersion ?? null);
        priorityByPrdId.set(row.id, (row.priority ?? "normal") as PrdPriority);
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
        priority: priorityByPrdId.get(p.prdId) ?? ("normal" as PrdPriority),
        ...counts,
        latestReview,
        previewTasks,
        tags: tagsByPrdId.get(p.prdId) ?? [],
        targetVersion: targetVersionByPrdId.get(p.prdId) ?? null,
      };
    });

    return c.json({ prds }, 200);
  })
  .get("/prds/:id", async (c) => {
    const { id } = c.req.param();

    const prd = await getRuntime().runPromise(DomainPrds.getPrd(id));
    if (!prd) return c.json({ error: "Not found" }, 404);

    const logical = await getRuntime().runPromise(DomainPrds.getLogicalPrd(prd.prdId));
    const priority = (logical?.priority ?? "normal") as PrdPriority;

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

    // Groupings (PRD 0019 / T4): tags, dependencies, dependents, milestone.
    // All three live on the *logical* PRD so we resolve them via `prd.prdId`.
    const tags = await getRuntime().runPromise(DomainTags.listTagsForPrd(prd.id));
    const dependenciesRaw = await getRuntime().runPromise(
      DomainDependencies.listDependencies(prd.prdId),
    );
    const dependentsRaw = await getRuntime().runPromise(
      DomainDependencies.listDependents(prd.prdId),
    );
    const projectPrds = await getRuntime().runPromise(
      DomainPrds.listPrds({ projectId: prd.projectId, latestOnly: true }),
    );
    const headByPrdId = new Map(projectPrds.map((p) => [p.prdId, p]));
    const decorate = (logical: { id: string }) => {
      const head = headByPrdId.get(logical.id);
      return {
        prdId: logical.id,
        headRevisionId: head?.id ?? null,
        title: head?.title ?? null,
        status: head?.status ?? null,
      };
    };
    const dependencies = dependenciesRaw.map(decorate);
    const dependents = dependentsRaw.map(decorate);
    const targetVersion = logical?.targetVersion ?? null;

    // Annexes (PRD 0024 / T2): list name/kind/description only — the full
    // `content` is fetched on demand via GET /prds/:id/annexes/:annexId so the
    // detail payload stays small even when a revision carries large HTML
    // prototypes. `brokenAnnexRefs` mirrors the CLI `prd show` warning so the
    // UI can render `[annex: <name>]` mentions with no matching annex as a
    // muted "broken" chip.
    const annexRows = await getRuntime().runPromise(DomainAnnexes.listAnnexes(prd.id));
    const annexes = annexRows.map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      description: a.description,
      createdAt: a.createdAt,
    }));
    const annexNames = new Set(annexRows.map((a) => a.name));
    const referencedBody = [
      prd.context,
      prd.scope,
      prd.problem,
      prd.solution,
      prd.implementationDecisions,
      prd.testingDecisions,
    ]
      .filter((s): s is string => typeof s === "string")
      .join("\n");
    const brokenAnnexRefs = DomainAnnexes.extractAnnexRefs(referencedBody).filter(
      (name) => !annexNames.has(name),
    );

    // Source ideas (PRD 0027 / T7): the uncommitted ideas that motivated this
    // PRD, attached to the *logical* PRD so they survive forks (like tags /
    // dependencies). Surfaced on the detail payload the same way annexes are.
    // Ideas are short by construction, so the full `body` ships inline.
    const sourceIdeaRows = await getRuntime().runPromise(DomainIdeas.listPrdIdeas(prd.prdId));
    const sourceIdeas = sourceIdeaRows.map((idea) => ({
      id: idea.id,
      title: idea.title,
      body: idea.body,
      tag: idea.tag,
      status: idea.status,
      promotedPrdId: idea.promotedPrdId,
      createdAt: idea.createdAt,
    }));

    return c.json(
      {
        prd: { ...prd, priority },
        tasks,
        reviews,
        revisions,
        activity,
        workspace,
        tags,
        targetVersion,
        dependencies,
        dependents,
        annexes,
        brokenAnnexRefs,
        sourceIdeas,
      },
      200,
    );
  })
  .get("/prds/:id/annexes/:annexId", async (c) => {
    const { id, annexId } = c.req.param();
    const prd = await getRuntime().runPromise(DomainPrds.getPrd(id));
    if (!prd) return c.json({ error: "Not found" }, 404);

    try {
      const annex = await getRuntime().runPromise(DomainAnnexes.getAnnex(annexId));
      if (annex.prdRevisionId !== id) return c.json({ error: "Not found" }, 404);
      return c.json({ annex }, 200);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/not found/i.test(msg)) return c.json({ error: msg }, 404);
      return c.json({ error: msg }, 422);
    }
  })
  .post("/prds/:id/annexes", async (c) => {
    const { id } = c.req.param();
    const prd = await getRuntime().runPromise(DomainPrds.getPrd(id));
    if (!prd) return c.json({ error: "Not found" }, 404);

    type Body = {
      name?: string;
      kind?: string;
      description?: string | null;
      content?: string;
      replace?: boolean;
    };
    const body = (await c.req.json().catch(() => ({}))) as Body;
    if (!body.name || typeof body.name !== "string") {
      return c.json({ error: "name is required" }, 422);
    }
    if (!body.kind || !isValidAnnexKind(body.kind)) {
      return c.json({ error: `kind must be one of ${VALID_ANNEX_KINDS.join(", ")}` }, 422);
    }
    if (typeof body.content !== "string" || body.content.length === 0) {
      return c.json({ error: "content is required" }, 422);
    }
    if (body.description != null && typeof body.description !== "string") {
      return c.json({ error: "description must be a string or null" }, 422);
    }

    try {
      const row = await getRuntime().runPromise(
        DomainAnnexes.addAnnex(prd.id, {
          name: body.name,
          kind: body.kind as AnnexKind,
          description: body.description ?? null,
          content: body.content,
          replace: body.replace === true,
        }),
      );
      await getRuntime().runPromise(
        logActivity({
          projectId: prd.projectId,
          workspaceId: prd.workspaceId ?? undefined,
          prdRevisionId: prd.id,
          eventType: "prd_annex_added",
          payload: { annexId: row.id, name: row.name, kind: row.kind },
          source: "human",
        }),
      );
      return c.json(
        {
          item: {
            id: row.id,
            name: row.name,
            kind: row.kind,
            description: row.description,
            createdAt: row.createdAt,
          },
        },
        201,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/already exists/i.test(msg)) return c.json({ error: msg }, 409);
      return c.json({ error: msg }, 422);
    }
  })
  .delete("/prds/:id/annexes/:annexId", async (c) => {
    const { id, annexId } = c.req.param();
    const prd = await getRuntime().runPromise(DomainPrds.getPrd(id));
    if (!prd) return c.json({ error: "Not found" }, 404);

    try {
      const row = await getRuntime().runPromise(DomainAnnexes.getAnnex(annexId));
      if (row.prdRevisionId !== id) return c.json({ error: "Not found" }, 404);
      await getRuntime().runPromise(DomainAnnexes.removeAnnex(annexId));
      await getRuntime().runPromise(
        logActivity({
          projectId: prd.projectId,
          workspaceId: prd.workspaceId ?? undefined,
          prdRevisionId: prd.id,
          eventType: "prd_annex_removed",
          payload: { annexId: row.id, name: row.name, kind: row.kind },
          source: "human",
        }),
      );
      return c.json({ prdRevisionId: prd.id, annexId: row.id, name: row.name }, 200);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/not found/i.test(msg)) return c.json({ error: msg }, 404);
      return c.json({ error: msg }, 422);
    }
  })
  .patch("/prds/:id/priority", async (c) => {
    const { id } = c.req.param();
    type Body = { priority?: string };
    const body = (await c.req.json().catch(() => ({}))) as Body;
    if (!body.priority || !isValidPrdPriority(body.priority)) {
      return c.json(
        {
          error: `priority must be one of ${VALID_PRD_PRIORITIES.join(", ")}`,
        },
        422,
      );
    }
    try {
      const result = await getRuntime().runPromise(DomainPriority.setPriority(id, body.priority));
      return c.json(
        {
          item: result.prd,
          changed: result.changed,
          previousPriority: result.previousPriority,
          newPriority: result.newPriority,
        },
        200,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/not found/i.test(msg)) return c.json({ error: msg }, 404);
      return c.json({ error: msg }, 422);
    }
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
  })
  // ── PRD groupings (PRD 0019 / T4) ────────────────────────────────────────
  // Tags / dependencies / milestone CRUD. Each surface mirrors the
  // corresponding CLI command (`depot prd tag|depend|milestone …`) and emits
  // the same activity_log events. Tags + milestone live on the logical PRD;
  // dependencies are M:N between logical PRDs. All endpoints take the PRD
  // *revision* id in the URL and resolve to the logical id internally so the
  // UI can keep using whatever id it already has.
  .post("/prds/:id/tags", async (c) => {
    const { id } = c.req.param();
    const prd = await getRuntime().runPromise(DomainPrds.getPrd(id));
    if (!prd) return c.json({ error: "Not found" }, 404);

    type Body = { tag?: string };
    const body = (await c.req.json().catch(() => ({}))) as Body;
    if (!body.tag || typeof body.tag !== "string") {
      return c.json({ error: "tag is required" }, 422);
    }
    const reason = invalidTagReason(body.tag);
    if (reason !== null) {
      return c.json({ error: reason }, 422);
    }

    try {
      const item = await getRuntime().runPromise(DomainTags.addTag(prd.id, body.tag));
      await getRuntime().runPromise(
        logActivity({
          projectId: prd.projectId,
          workspaceId: prd.workspaceId ?? undefined,
          prdRevisionId: prd.id,
          eventType: "prd_tag_added",
          payload: { prdId: item.prdId, tag: item.tag },
          source: "human",
        }),
      );
      return c.json({ item }, 201);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 422);
    }
  })
  .delete("/prds/:id/tags/:tag", async (c) => {
    const { id, tag } = c.req.param();
    const prd = await getRuntime().runPromise(DomainPrds.getPrd(id));
    if (!prd) return c.json({ error: "Not found" }, 404);

    try {
      const result = await getRuntime().runPromise(DomainTags.removeTag(prd.id, tag));
      await getRuntime().runPromise(
        logActivity({
          projectId: prd.projectId,
          workspaceId: prd.workspaceId ?? undefined,
          prdRevisionId: prd.id,
          eventType: "prd_tag_removed",
          payload: { prdId: result.prdId, tag },
          source: "human",
        }),
      );
      return c.json({ prdId: result.prdId, tag }, 200);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 422);
    }
  })
  .post("/prds/:id/dependencies", async (c) => {
    const { id } = c.req.param();
    const prd = await getRuntime().runPromise(DomainPrds.getPrd(id));
    if (!prd) return c.json({ error: "Not found" }, 404);

    type Body = { dependsOnPrdId?: string };
    const body = (await c.req.json().catch(() => ({}))) as Body;
    if (!body.dependsOnPrdId || typeof body.dependsOnPrdId !== "string") {
      return c.json({ error: "dependsOnPrdId is required" }, 422);
    }
    // Accept either a logical PRD id or a revision id so the UI can stay
    // agnostic — same convenience the CLI offers via `resolveLogicalPrdId`.
    const targetRev = await getRuntime().runPromise(DomainPrds.getPrd(body.dependsOnPrdId));
    const dependsOnLogicalId = targetRev?.prdId ?? body.dependsOnPrdId;

    try {
      const item = await getRuntime().runPromise(
        DomainDependencies.addDependency(prd.prdId, dependsOnLogicalId),
      );
      await getRuntime().runPromise(
        logActivity({
          projectId: prd.projectId,
          workspaceId: prd.workspaceId ?? undefined,
          prdRevisionId: prd.id,
          eventType: "prd_depend_added",
          payload: { prdId: prd.prdId, dependsOnPrdId: dependsOnLogicalId },
          source: "human",
        }),
      );
      return c.json({ item }, 201);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 422);
    }
  })
  .delete("/prds/:id/dependencies/:dependsOnPrdId", async (c) => {
    const { id, dependsOnPrdId } = c.req.param();
    const prd = await getRuntime().runPromise(DomainPrds.getPrd(id));
    if (!prd) return c.json({ error: "Not found" }, 404);

    const targetRev = await getRuntime().runPromise(DomainPrds.getPrd(dependsOnPrdId));
    const dependsOnLogicalId = targetRev?.prdId ?? dependsOnPrdId;

    try {
      await getRuntime().runPromise(
        DomainDependencies.removeDependency(prd.prdId, dependsOnLogicalId),
      );
      await getRuntime().runPromise(
        logActivity({
          projectId: prd.projectId,
          workspaceId: prd.workspaceId ?? undefined,
          prdRevisionId: prd.id,
          eventType: "prd_depend_removed",
          payload: { prdId: prd.prdId, dependsOnPrdId: dependsOnLogicalId },
          source: "human",
        }),
      );
      return c.json({ prdId: prd.prdId, dependsOnPrdId: dependsOnLogicalId }, 200);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 422);
    }
  })
  .patch("/prds/:id/milestone", async (c) => {
    const { id } = c.req.param();
    const prd = await getRuntime().runPromise(DomainPrds.getPrd(id));
    if (!prd) return c.json({ error: "Not found" }, 404);

    type Body = { version?: string | null };
    const body = (await c.req.json().catch(() => ({}))) as Body;
    if (body.version === undefined) {
      return c.json({ error: "version is required (string or null)" }, 422);
    }
    if (body.version !== null && typeof body.version !== "string") {
      return c.json({ error: "version must be a string or null" }, 422);
    }

    try {
      if (body.version === null) {
        const result = await getRuntime().runPromise(DomainMilestones.unsetMilestone(prd.id));
        return c.json({ item: result.prd, changed: result.changed, version: null }, 200);
      }
      if (!isValidMilestone(body.version)) {
        const trimmedLength = body.version.trim().length;
        const reason =
          trimmedLength === 0
            ? `Milestone must be non-empty.`
            : `Milestone is longer than the ${MAX_MILESTONE_LENGTH}-character limit (${trimmedLength}).`;
        return c.json({ error: reason }, 422);
      }
      const result = await getRuntime().runPromise(
        DomainMilestones.setMilestone(prd.id, body.version),
      );
      return c.json({ item: result.prd, changed: result.changed, version: result.newVersion }, 200);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 422);
    }
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
