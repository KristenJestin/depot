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
import { resolveProjectRepos, type ResolvedRepo } from "#/modules/projects/repos";
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
      "-c",
      "core.excludesFile=",
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

/**
 * Resolve which repo a repo-aware git endpoint should target.
 *
 * Goes through `resolveProjectRepos` so a mono-repo project (no `project_repo`
 * rows) transparently resolves to its single implicit repo. When the project
 * has registered repos and `repoName` is provided, the named repo is returned;
 * when `repoName` is omitted, the primary repo (or the first one) is used so
 * the legacy single-repo behaviour still has a sensible default.
 */
async function resolveTargetRepo(
  projectId: string,
  workspacePath: string,
  repoName: string | null,
): Promise<{ ok: true; repo: ResolvedRepo } | { ok: false; error: string }> {
  const repos = await getRuntime().runPromise(resolveProjectRepos(projectId, workspacePath));
  if (repos.length === 0) {
    return { ok: false, error: "Project has no resolvable repo" };
  }
  if (repoName) {
    const match = repos.find((r) => r.name === repoName);
    if (!match) {
      return {
        ok: false,
        error: `Unknown repo '${repoName}'. Known repos: ${repos.map((r) => r.name).join(", ")}`,
      };
    }
    return { ok: true, repo: match };
  }
  const primary = repos.find((r) => r.isPrimary) ?? repos[0]!;
  return { ok: true, repo: primary };
}

type DiffFile = { path: string; additions: number; deletions: number };

type RepoDiff = {
  repoName: string;
  repoPath: string;
  sha: string | null;
  diff: string;
  files: DiffFile[];
};

/** Parse `git --numstat` output into per-file additions/deletions. */
function parseNumstat(stdout: string): DiffFile[] {
  return stdout
    .trim()
    .split("\n")
    .filter((l) => l.length > 0)
    .map((line) => {
      const [add, del, p] = line.split("\t");
      return {
        path: p ?? "",
        additions: Number(add) || 0,
        deletions: Number(del) || 0,
      };
    });
}

/** Diff the working tree of a repo against HEAD (best-effort file summary). */
async function computeWorkingTreeDiff(
  repoPath: string,
): Promise<{ diff: string; files: DiffFile[] }> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", repoPath, "diff", "HEAD"], {
      maxBuffer: 50 * 1024 * 1024,
    });
    let files: DiffFile[] = [];
    try {
      const stat = await execFileAsync("git", ["-C", repoPath, "diff", "--numstat", "HEAD"], {
        maxBuffer: 10 * 1024 * 1024,
      });
      files = parseNumstat(stat.stdout);
    } catch {
      // best-effort summary
    }
    return { diff: stdout, files };
  } catch {
    // A repo path that is not a git checkout (or git unavailable) yields an
    // empty diff rather than failing the whole aggregation.
    return { diff: "", files: [] };
  }
}

/** Diff a `since..until` commit range in a repo. Throws on git failure. */
async function computeRangeDiff(
  repoPath: string,
  since: string,
  until: string,
): Promise<{ diff: string; files: DiffFile[] }> {
  const range = `${since}..${until}`;
  const { stdout } = await execFileAsync("git", ["-C", repoPath, "diff", range], {
    maxBuffer: 50 * 1024 * 1024,
  });
  let files: DiffFile[] = [];
  try {
    const stat = await execFileAsync("git", ["-C", repoPath, "diff", "--numstat", range], {
      maxBuffer: 10 * 1024 * 1024,
    });
    files = parseNumstat(stat.stdout);
  } catch {
    // best-effort summary
  }
  return { diff: stdout, files };
}

/**
 * Diff a single squash-merge commit (`<sha>^..<sha>`). Used post-merge: each
 * `prd_merge` anchors one commit per repo. Falls back to an empty diff when
 * the commit or repo cannot be resolved so one missing repo never fails the
 * whole aggregation.
 */
async function computeShowDiff(
  repoPath: string,
  sha: string,
): Promise<{ diff: string; files: DiffFile[] }> {
  try {
    return await computeRangeDiff(repoPath, `${sha}^`, sha);
  } catch {
    return { diff: "", files: [] };
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
  .get("/prds/:id/git-status", async (c) => {
    const { id } = c.req.param();
    const repoName = c.req.query("repo") ?? null;
    const prd = await getRuntime().runPromise(DomainPrds.getPrd(id));
    if (!prd) return c.json({ error: "Not found" }, 404);
    const ws = prd.workspaceId
      ? await c.var.db.query.workspaces.findFirst({ where: { id: prd.workspaceId } })
      : null;
    if (!ws) return c.json({ error: "PRD has no workspace" }, 400);
    const target = await resolveTargetRepo(prd.projectId, ws.path, repoName);
    if (!target.ok) return c.json({ error: target.error }, 400);
    const status = await readGitStatus(target.repo.path);
    if (!status.ok) return c.json({ error: status.error }, 500);
    return c.json({ ...status, repo: target.repo.name }, 200);
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

    const body = (await c.req.json()) as { message?: string; files?: string[]; repo?: string };
    const message = body.message?.trim();
    if (!message) return c.json({ error: "Commit message is required" }, 422);

    const target = await resolveTargetRepo(prd.projectId, ws.path, body.repo ?? null);
    if (!target.ok) return c.json({ error: target.error }, 400);
    const repoPath = target.repo.path;

    const status = await readGitStatus(repoPath);
    if (!status.ok) return c.json({ error: status.error }, 500);

    // The base branch comes from the targeted repo (a `project_repo` carries
    // its own `baseBranch`). For the implicit mono-repo it falls back to the
    // project config / `main` — `resolveProjectRepos` already applies that.
    const baseBranch = target.repo.baseBranch;
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
        await execFileAsync("git", ["-C", repoPath, "add", "--", ...filesToCommit]);
      }
      await execFileAsync("git", ["-C", repoPath, "commit", "-m", message]);
      const { stdout: shaStdout } = await execFileAsync("git", [
        "-C",
        repoPath,
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
          payload: { sha, message, filesChanged: filesToCommit.length, repo: target.repo.name },
          source: "human",
        }),
      );
      return c.json(
        { sha, message, filesChanged: filesToCommit.length, repo: target.repo.name },
        201,
      );
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

    const body = (await c.req.json().catch(() => ({}))) as { repo?: string };
    const target = await resolveTargetRepo(prd.projectId, ws.path, body.repo ?? null);
    if (!target.ok) return c.json({ error: target.error }, 400);
    const repoPath = target.repo.path;

    const status = await readGitStatus(repoPath);
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
      await execFileAsync("git", ["-C", repoPath, "push", "origin", status.branch ?? "HEAD"]);
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
            repo: target.repo.name,
          },
          source: "human",
        }),
      );
      return c.json(
        { branch: status.branch ?? "HEAD", commitsPushed, repo: target.repo.name },
        200,
      );
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

    if (fullParam === "true") {
      // Post-merge view: aggregate one `git show` per anchored merge commit.
      // For a multi-repo PRD this yields N repo diffs; a mono-repo PRD has a
      // single `prd_merge` row (or falls back to the legacy `mergedAtSha`).
      const merges = await getRuntime().runPromise(DomainPrds.listMerges(id));
      const repoDiffs: RepoDiff[] = [];

      if (merges.length > 0) {
        for (const merge of merges) {
          const diff = await computeShowDiff(merge.repoPath, merge.mergeSha);
          repoDiffs.push({
            repoName: merge.repoName,
            repoPath: merge.repoPath,
            sha: merge.mergeSha,
            ...diff,
          });
        }
      } else {
        // Legacy fallback: no `prd_merge` row, but a `mergedAtSha` /
        // reachable `activatedAtSha` range on the implicit repo.
        const repos = await getRuntime().runPromise(
          resolveProjectRepos(prd.projectId, workspace.path),
        );
        const repo = repos.find((r) => r.isPrimary) ?? repos[0];
        if (!repo) {
          return c.json({ error: "PRD has no resolvable repo" }, 400);
        }
        const reachable = prd.activatedAtSha
          ? await execFileAsync("git", [
              "-C",
              repo.path,
              "cat-file",
              "-e",
              prd.activatedAtSha,
            ]).then(
              () => true,
              () => false,
            )
          : false;
        if (!reachable && prd.mergedAtSha) {
          const diff = await computeRangeDiff(repo.path, `${prd.mergedAtSha}^`, prd.mergedAtSha);
          repoDiffs.push({
            repoName: repo.name,
            repoPath: repo.path,
            sha: prd.mergedAtSha,
            ...diff,
          });
        } else if (prd.activatedAtSha) {
          const until = prd.doneAtSha ?? "HEAD";
          const diff = await computeRangeDiff(repo.path, prd.activatedAtSha, until);
          repoDiffs.push({
            repoName: repo.name,
            repoPath: repo.path,
            sha: prd.activatedAtSha,
            ...diff,
          });
        } else {
          return c.json({ error: "PRD has not been activated; no full diff range" }, 400);
        }
      }

      const first = repoDiffs[0];
      return c.json(
        {
          mode: "full" as const,
          since: null,
          until: first?.sha ?? null,
          diff: first?.diff ?? "",
          files: first?.files ?? [],
          repos: repoDiffs,
        },
        200,
      );
    }

    if (phaseParam) {
      const phaseN = Number(phaseParam);
      if (!Number.isFinite(phaseN) || phaseN <= 0) {
        return c.json({ error: "Invalid phase" }, 400);
      }
      const allSnaps = await getRuntime().runPromise(DomainPrds.listPhaseSnapshots(id));
      const target = allSnaps.find((s) => s.phaseNumber === phaseN);
      const prev = allSnaps.find((s) => s.phaseNumber === phaseN - 1);
      const since = prev?.advancedAtSha ?? prd.activatedAtSha;
      const until = target?.advancedAtSha ?? "HEAD";
      if (!since) {
        return c.json({ error: "Cannot resolve phase range; PRD not activated" }, 400);
      }
      // Phase snapshots anchor a single SHA — phase diffs stay mono-repo
      // (per-repo phase capture is a documented follow-up).
      const diff = await computeRangeDiff(workspace.path, since, until).catch((e) => e as Error);
      if (diff instanceof Error) {
        return c.json({ error: `git diff failed: ${diff.message}` }, 500);
      }
      return c.json(
        {
          mode: "phase" as const,
          since,
          until,
          diff: diff.diff,
          files: diff.files,
          repos: [
            {
              repoName: "(default)",
              repoPath: workspace.path,
              sha: until,
              diff: diff.diff,
              files: diff.files,
            },
          ],
        },
        200,
      );
    }

    // Working-tree view: `git diff HEAD` per registered repo (one implicit
    // repo for a mono-repo project).
    const repos = await getRuntime().runPromise(resolveProjectRepos(prd.projectId, workspace.path));
    const repoDiffs: RepoDiff[] = [];
    for (const repo of repos) {
      const diff = await computeWorkingTreeDiff(repo.path);
      repoDiffs.push({
        repoName: repo.name,
        repoPath: repo.path,
        sha: null,
        ...diff,
      });
    }
    const first = repoDiffs[0];
    return c.json(
      {
        mode: "working-tree" as const,
        since: null,
        until: null,
        diff: first?.diff ?? "",
        files: first?.files ?? [],
        repos: repoDiffs,
      },
      200,
    );
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
