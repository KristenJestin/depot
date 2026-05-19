import { Hono } from "hono";
import { asc, inArray } from "drizzle-orm";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { reviews, tasks } from "#/db/schema";
import { getRuntime } from "#/services/database";
import * as DomainPrds from "#/modules/prds/domain";
import * as DomainTasks from "#/modules/tasks/domain";
import * as DomainReviews from "#/modules/reviews/domain";
import * as DomainActivity from "#/modules/activity/domain";
import * as DomainOutOfScope from "#/modules/prds/out-of-scope";
import * as DomainProjectConfig from "#/modules/projects/config";
import { logActivity } from "#/modules/activity/domain";
import type { Variables } from "./types";

const execFileAsync = promisify(execFile);

const PROTECTED_BASE_BRANCHES = new Set(["main", "master", "develop"]);

async function readGitStatus(wsPath: string): Promise<
  | {
      ok: true;
      branch: string | null;
      upstream: string | null;
      ahead: number;
      behind: number;
      files: Array<{ path: string; status: string; staged: boolean }>;
    }
  | { ok: false; error: string }
> {
  try {
    const { stdout } = await execFileAsync("git", [
      "-C",
      wsPath,
      "status",
      "--porcelain=v2",
      "--branch",
    ]);
    let branch: string | null = null;
    let upstream: string | null = null;
    let ahead = 0;
    let behind = 0;
    const files: Array<{ path: string; status: string; staged: boolean }> = [];
    for (const line of stdout.split("\n")) {
      if (line.startsWith("# branch.head ")) branch = line.slice("# branch.head ".length).trim();
      else if (line.startsWith("# branch.upstream "))
        upstream = line.slice("# branch.upstream ".length).trim();
      else if (line.startsWith("# branch.ab ")) {
        const parts = line.slice("# branch.ab ".length).split(" ");
        ahead = Math.abs(Number(parts[0]) || 0);
        behind = Math.abs(Number(parts[1]) || 0);
      } else if (line.startsWith("1 ") || line.startsWith("2 ")) {
        // tracked changed files
        const cols = line.split(" ");
        const xy = cols[1] ?? "..";
        const staged = xy[0] !== "." && xy[0] !== "?";
        const path = cols.slice(8).join(" ");
        files.push({ path, status: xy, staged });
      } else if (line.startsWith("? ")) {
        files.push({ path: line.slice(2), status: "??", staged: false });
      }
    }
    return { ok: true, branch, upstream, ahead, behind, files };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

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
  .get("/prds/:id/git-status", async (c) => {
    const { id } = c.req.param();
    const prd = await getRuntime().runPromise(DomainPrds.getPrd(id));
    if (!prd) return c.json({ error: "Not found" }, 404);
    const ws = prd.workspaceId
      ? await c.var.db.query.workspaces.findFirst({ where: { id: prd.workspaceId } })
      : null;
    if (!ws) return c.json({ error: "PRD has no workspace" }, 400);
    const status = await readGitStatus(ws.path);
    if (!status.ok) return c.json({ error: status.error }, 500);
    return c.json(status, 200);
  })
  .get("/prds/:id/commit-suggestion", async (c) => {
    const { id } = c.req.param();
    const phaseParam = c.req.query("phase");
    const prd = await getRuntime().runPromise(DomainPrds.getPrd(id));
    if (!prd) return c.json({ error: "Not found" }, 404);

    let phaseSuggestion: string | null = null;
    let phase: number | null = null;
    if (phaseParam) {
      const parsed = Number(phaseParam);
      if (Number.isFinite(parsed) && parsed > 0) {
        phase = parsed;
        const snapshot = await getRuntime().runPromise(DomainPrds.getPhaseSnapshot(id, parsed));
        phaseSuggestion = snapshot?.suggestedCommitMessage ?? null;
      }
    }

    const prdSuggestion = prd.suggestedCommitMessage ?? null;
    return c.json(
      {
        phase,
        phaseSuggestedCommitMessage: phaseSuggestion,
        prdSuggestedCommitMessage: prdSuggestion,
        suggestedCommitMessage: phaseSuggestion ?? prdSuggestion,
      },
      200,
    );
  })
  .post("/prds/:id/commit", async (c) => {
    const { id } = c.req.param();
    const prd = await getRuntime().runPromise(DomainPrds.getPrd(id));
    if (!prd) return c.json({ error: "Not found" }, 404);
    const ws = prd.workspaceId
      ? await c.var.db.query.workspaces.findFirst({ where: { id: prd.workspaceId } })
      : null;
    if (!ws) return c.json({ error: "PRD has no workspace" }, 400);

    const body = (await c.req.json()) as { message?: string; files?: string[] };
    const message = body.message?.trim();
    if (!message) return c.json({ error: "Commit message is required" }, 422);

    const status = await readGitStatus(ws.path);
    if (!status.ok) return c.json({ error: status.error }, 500);

    // Resolve base branch from project config (default to common protected names).
    const baseBranchRow = await getRuntime().runPromise(
      DomainProjectConfig.getConfig(prd.projectId, "baseBranch"),
    );
    const baseBranch = baseBranchRow?.value ?? "main";
    if (
      status.branch &&
      (status.branch === baseBranch || PROTECTED_BASE_BRANCHES.has(status.branch))
    ) {
      return c.json(
        {
          error: `Refusing to commit directly on protected branch '${status.branch}'. Switch to a feature branch first.`,
        },
        403,
      );
    }

    // Check protected files.
    const protectedRow = await getRuntime().runPromise(
      DomainProjectConfig.getConfig(prd.projectId, "protectedFiles"),
    );
    const protectedPaths = new Set(
      (protectedRow?.value ?? ".env,secrets")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    );
    const filesToCommit = body.files ?? status.files.map((f) => f.path);
    for (const p of filesToCommit) {
      for (const protectedPath of protectedPaths) {
        if (p === protectedPath || p.startsWith(`${protectedPath}/`)) {
          return c.json({ error: `Refusing to commit protected path: ${p}` }, 403);
        }
      }
    }

    try {
      if (filesToCommit.length > 0) {
        await execFileAsync("git", ["-C", ws.path, "add", "--", ...filesToCommit]);
      }
      await execFileAsync("git", ["-C", ws.path, "commit", "-m", message]);
      const { stdout: shaStdout } = await execFileAsync("git", [
        "-C",
        ws.path,
        "rev-parse",
        "HEAD",
      ]);
      const sha = shaStdout.trim();
      await getRuntime().runPromise(
        logActivity({
          projectId: prd.projectId,
          workspaceId: prd.workspaceId ?? undefined,
          prdRevisionId: prd.id,
          eventType: "git_commit",
          payload: { sha, message, filesChanged: filesToCommit.length },
          source: "human",
        }),
      );
      return c.json({ sha, message, filesChanged: filesToCommit.length }, 201);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return c.json({ error: `git commit failed: ${msg}` }, 422);
    }
  })
  .post("/prds/:id/push", async (c) => {
    const { id } = c.req.param();
    const prd = await getRuntime().runPromise(DomainPrds.getPrd(id));
    if (!prd) return c.json({ error: "Not found" }, 404);
    const ws = prd.workspaceId
      ? await c.var.db.query.workspaces.findFirst({ where: { id: prd.workspaceId } })
      : null;
    if (!ws) return c.json({ error: "PRD has no workspace" }, 400);

    const status = await readGitStatus(ws.path);
    if (!status.ok) return c.json({ error: status.error }, 500);
    if (status.branch && PROTECTED_BASE_BRANCHES.has(status.branch)) {
      return c.json({ error: `Refusing to push from protected branch '${status.branch}'` }, 403);
    }
    if (status.files.length > 0) {
      return c.json({ error: "Working tree is not clean — commit or stash first" }, 409);
    }
    if (status.behind > 0) {
      return c.json(
        {
          error:
            "Branch diverged from upstream — pull/rebase first; conflict resolution is not done in the web UI",
        },
        409,
      );
    }

    try {
      await execFileAsync("git", ["-C", ws.path, "push", "origin", status.branch ?? "HEAD"]);
      const commitsPushed = status.ahead;
      await getRuntime().runPromise(
        logActivity({
          projectId: prd.projectId,
          workspaceId: prd.workspaceId ?? undefined,
          prdRevisionId: prd.id,
          eventType: "git_push",
          payload: {
            branch: status.branch ?? "HEAD",
            remote: "origin",
            commitsPushed,
          },
          source: "human",
        }),
      );
      return c.json({ branch: status.branch ?? "HEAD", commitsPushed }, 200);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return c.json({ error: `git push failed: ${msg}` }, 500);
    }
  })
  .get("/prds/:id/diff-tree", async (c) => {
    const { id } = c.req.param();
    const phaseParam = c.req.query("phase");

    const prd = await getRuntime().runPromise(DomainPrds.getPrd(id));
    if (!prd) return c.json({ error: "Not found" }, 404);
    const ws = prd.workspaceId
      ? await c.var.db.query.workspaces.findFirst({ where: { id: prd.workspaceId } })
      : null;
    if (!ws) return c.json({ error: "PRD has no workspace" }, 400);

    const gitArgs = ["-C", ws.path, "diff", "--name-status"];
    if (phaseParam) {
      const phaseN = Number(phaseParam);
      if (Number.isFinite(phaseN) && phaseN > 0) {
        const allSnaps = await getRuntime().runPromise(DomainPrds.listPhaseSnapshots(id));
        const target = allSnaps.find((s) => s.phaseNumber === phaseN);
        const prev = allSnaps.find((s) => s.phaseNumber === phaseN - 1);
        const since = prev?.advancedAtSha ?? prd.activatedAtSha;
        const until = target?.advancedAtSha ?? "HEAD";
        if (since) gitArgs.push(`${since}..${until}`);
        else gitArgs.push("HEAD");
      } else {
        gitArgs.push("HEAD");
      }
    } else {
      gitArgs.push("HEAD");
    }

    try {
      const { stdout } = await execFileAsync("git", gitArgs, { maxBuffer: 10 * 1024 * 1024 });
      const files = stdout
        .trim()
        .split("\n")
        .filter((l) => l.length > 0)
        .map((line) => {
          const [statusChar, ...pathParts] = line.split("\t");
          return {
            path: pathParts.join("\t"),
            status: statusChar ?? "M",
          };
        });
      return c.json({ files }, 200);
    } catch (e) {
      return c.json(
        { error: `git diff --name-status failed: ${e instanceof Error ? e.message : String(e)}` },
        500,
      );
    }
  })
  .post("/prds/:id/recapture-sha", async (c) => {
    const { id } = c.req.param();
    const prd = await getRuntime().runPromise(DomainPrds.getPrd(id));
    if (!prd) return c.json({ error: "Not found" }, 404);
    const ws = prd.workspaceId
      ? await c.var.db.query.workspaces.findFirst({ where: { id: prd.workspaceId } })
      : null;
    if (!ws) return c.json({ error: "PRD has no workspace" }, 400);

    // Read which field to recapture from query string: ?field=done|activated
    const field = c.req.query("field") === "activated" ? "activatedAtSha" : "doneAtSha";
    try {
      const { stdout } = await execFileAsync("git", ["-C", ws.path, "rev-parse", "HEAD"]);
      const sha = stdout.trim();
      const db = c.var.db;
      const { prdRevisions } = await import("#/db/schema");
      const { eq: drizzleEq } = await import("drizzle-orm");
      db.update(prdRevisions)
        .set({ [field]: sha })
        .where(drizzleEq(prdRevisions.id, id))
        .run();
      return c.json({ field, sha }, 200);
    } catch (e) {
      return c.json(
        { error: `recapture failed: ${e instanceof Error ? e.message : String(e)}` },
        500,
      );
    }
  })
  .get("/prds/:id/diff", async (c) => {
    const { id } = c.req.param();
    const phaseParam = c.req.query("phase");
    const fullParam = c.req.query("full");

    const prd = await getRuntime().runPromise(DomainPrds.getPrd(id));
    if (!prd) return c.json({ error: "Not found" }, 404);

    const workspace = prd.workspaceId
      ? await c.var.db.query.workspaces.findFirst({ where: { id: prd.workspaceId } })
      : null;
    if (!workspace) {
      return c.json({ error: "PRD is not associated with a workspace" }, 400);
    }

    let mode: "working-tree" | "phase" | "full" = "working-tree";
    let since: string | null = null;
    let until: string | null = null;
    const gitArgs: string[] = ["-C", workspace.path, "diff"];

    if (fullParam === "true") {
      // If the feature branch was squash-merged, `activatedAtSha` / `doneAtSha`
      // may now refer to garbage-collected commits. When that happens and we
      // have a `mergedAtSha` (post-merge commit on the base branch), fall
      // back to that single commit's diff — git show <mergedAtSha> via the
      // `mergedAtSha^..mergedAtSha` range gives the full PRD diff in one go.
      const reachable = prd.activatedAtSha
        ? await execFileAsync("git", [
            "-C",
            workspace.path,
            "cat-file",
            "-e",
            prd.activatedAtSha,
          ]).then(
            () => true,
            () => false,
          )
        : false;

      if (!reachable && prd.mergedAtSha) {
        mode = "full";
        since = `${prd.mergedAtSha}^`;
        until = prd.mergedAtSha;
        gitArgs.push(`${since}..${until}`);
      } else if (prd.activatedAtSha) {
        mode = "full";
        since = prd.activatedAtSha;
        until = prd.doneAtSha ?? "HEAD";
        gitArgs.push(`${since}..${until}`);
      } else {
        return c.json({ error: "PRD has not been activated; no full diff range" }, 400);
      }
    } else if (phaseParam) {
      const phaseN = Number(phaseParam);
      if (!Number.isFinite(phaseN) || phaseN <= 0) {
        return c.json({ error: "Invalid phase" }, 400);
      }
      const allSnaps = await getRuntime().runPromise(DomainPrds.listPhaseSnapshots(id));
      const target = allSnaps.find((s) => s.phaseNumber === phaseN);
      const prev = allSnaps.find((s) => s.phaseNumber === phaseN - 1);
      since = prev?.advancedAtSha ?? prd.activatedAtSha;
      until = target?.advancedAtSha ?? "HEAD";
      if (!since) {
        return c.json({ error: "Cannot resolve phase range; PRD not activated" }, 400);
      }
      mode = "phase";
      gitArgs.push(`${since}..${until}`);
    } else {
      gitArgs.push("HEAD");
    }

    let stdout = "";
    try {
      const result = await execFileAsync("git", gitArgs, { maxBuffer: 50 * 1024 * 1024 });
      stdout = result.stdout;
    } catch (e) {
      return c.json(
        { error: `git diff failed: ${e instanceof Error ? e.message : String(e)}` },
        500,
      );
    }

    // Lightweight file summary from git numstat (additions/deletions per file).
    let files: Array<{ path: string; additions: number; deletions: number }> = [];
    try {
      const statArgs = [...gitArgs.slice(0, -1), "--numstat", gitArgs[gitArgs.length - 1]!];
      const stat = await execFileAsync("git", statArgs, { maxBuffer: 10 * 1024 * 1024 });
      files = stat.stdout
        .trim()
        .split("\n")
        .filter((l) => l.length > 0)
        .map((line) => {
          const [add, del, path] = line.split("\t");
          return {
            path: path ?? "",
            additions: Number(add) || 0,
            deletions: Number(del) || 0,
          };
        });
    } catch {
      // best-effort summary
    }

    return c.json({ mode, since, until, diff: stdout, files }, 200);
  })
  .get("/prds/:id/context-panel", async (c) => {
    const { id } = c.req.param();
    const phaseParam = c.req.query("phase");
    const prd = await getRuntime().runPromise(DomainPrds.getPrd(id));
    if (!prd) return c.json({ error: "Not found" }, 404);

    let reviewBrief: string | null = null;
    let currentPhaseTasks: unknown[] = [];
    if (phaseParam) {
      const phaseN = Number(phaseParam);
      if (Number.isFinite(phaseN) && phaseN > 0) {
        const snap = await getRuntime().runPromise(DomainPrds.getPhaseSnapshot(id, phaseN));
        reviewBrief = snap?.reviewBrief ?? null;
        const allTasks = await getRuntime().runPromise(
          DomainTasks.listTasks(id, { prdTasksOnly: true }),
        );
        currentPhaseTasks = allTasks.filter((t) => t.phaseNumber === phaseN);
      }
    }

    const allPrdTasks = await getRuntime().runPromise(
      DomainTasks.listTasks(id, { prdTasksOnly: true }),
    );
    const futurePhases: Array<{ number: number; taskTitlesShort: string[] }> = [];
    if (prd.currentPhase !== null) {
      const phasesAfter = [
        ...new Set(
          allPrdTasks
            .map((t) => t.phaseNumber)
            .filter((p): p is number => p !== null && p > (prd.currentPhase ?? 0)),
        ),
      ].sort((a, b) => a - b);
      for (const p of phasesAfter) {
        futurePhases.push({
          number: p,
          taskTitlesShort: allPrdTasks
            .filter((t) => t.phaseNumber === p)
            .map((t) => t.title)
            .slice(0, 5),
        });
      }
    }

    const outOfScopeItems = await getRuntime().runPromise(
      DomainOutOfScope.listOutOfScope({ projectId: prd.projectId, prdRevisionId: prd.id }),
    );

    return c.json({ reviewBrief, currentPhaseTasks, futurePhases, outOfScopeItems }, 200);
  })
  .post("/prds/:id/reviews/human-diff", async (c) => {
    const { id } = c.req.param();
    const prd = await getRuntime().runPromise(DomainPrds.getPrd(id));
    if (!prd) return c.json({ error: "Not found" }, 404);

    type Annotation = {
      filePath: string;
      startLine: number;
      endLine: number;
      diffSha?: string;
      text: string;
      kind: "finding" | "deferred-question";
    };
    const body = (await c.req.json()) as { annotations?: Annotation[] };
    const annotations = body.annotations ?? [];
    if (annotations.length === 0) {
      return c.json({ error: "At least one annotation required" }, 400);
    }

    const review = await getRuntime().runPromise(
      DomainReviews.createReview({ prdRevisionId: id, type: "human" }),
    );

    for (const a of annotations) {
      const description =
        a.kind === "deferred-question" ? `User asks: is this deferred? ${a.text}` : a.text;
      await getRuntime().runPromise(
        DomainReviews.addReviewTask(review.id, {
          title: `${a.filePath}:${a.startLine}-${a.endLine}`,
          description,
          doneCriteria: a.kind === "deferred-question" ? "User question resolved" : "Issue fixed",
          axis: "human",
          triageState: a.kind === "deferred-question" ? "needs-info" : "needs-triage",
          linkedFilePath: a.filePath,
          linkedStartLine: a.startLine,
          linkedEndLine: a.endLine,
          linkedDiffSha: a.diffSha,
        }),
      );
    }

    return c.json({ reviewId: review.id }, 201);
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
