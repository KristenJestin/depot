import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";

import { getDb } from "#/services/database";
import { normalizeWorkspacePath } from "#/shared/utils";
import { workspaceExistsOnDisk } from "#/modules/workspaces/domain";
import type { Database } from "#/db/client";
import type { Variables } from "./types";
import { prdsRoutes } from "./prds";
import { pendingActionsRoutes } from "./pending-actions";
import { projectsRoutes } from "./projects";
import { docsRoutes } from "./docs";
import { adrsRoutes } from "./adrs";
import { milestonesRoutes } from "./milestones";
import { prototypesRoutes } from "./prototypes";
import { ideasRoutes } from "./ideas";

// Cookie used to remember the user's selected workspace across browser
// sessions and server restarts. Storing it server-readable lets every
// API request be scoped to the chosen project without the client having
// to round-trip the id on every call. The "__cleared" sentinel value
// represents the user explicitly choosing "no workspace" (different
// semantics from the cookie being absent — which falls back to the
// cwd-based hint).
const WORKSPACE_COOKIE = "depot_workspace_id";
const WORKSPACE_COOKIE_CLEARED = "__cleared";
const WORKSPACE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

async function resolveWorkspaceHint(db: Database): Promise<string | null> {
  const cwd = normalizeWorkspacePath(process.cwd());
  const all = await db.query.workspaces.findMany();
  let best: string | null = null;
  let bestLen = 0;
  for (const ws of all) {
    const p = normalizeWorkspacePath(ws.path);
    if (cwd === p || cwd.startsWith(p + "/")) {
      if (p.length > bestLen) {
        bestLen = p.length;
        best = ws.id;
      }
    }
  }
  return best;
}

const app = new Hono<{ Variables: Variables }>()
  .basePath("/api")
  .use("*", async (c, next) => {
    const db = await getDb();
    c.set("db", db);
    const cookie = getCookie(c, WORKSPACE_COOKIE);
    let wsId: string | null;
    if (cookie === WORKSPACE_COOKIE_CLEARED) {
      wsId = null;
    } else if (cookie) {
      wsId = cookie;
    } else {
      wsId = await resolveWorkspaceHint(db).catch(() => null);
    }
    c.set("currentWorkspaceId", wsId);
    await next();
  })
  .get("/ping", (c) => c.json({ ok: true }, 200))
  .get("/context", async (c) => {
    const db = c.var.db;
    const wsId = c.var.currentWorkspaceId;

    let workspacePath: string | null = null;
    let workspaceLabel: string | null = null;
    if (wsId) {
      const ws = await db.query.workspaces.findFirst({
        where: { id: wsId },
        columns: { path: true, label: true },
      });
      workspacePath = ws?.path ?? null;
      workspaceLabel = ws?.label ?? null;
    }

    return c.json({ workspaceId: wsId, workspacePath, workspaceLabel }, 200);
  })
  .patch("/context", async (c) => {
    const body = await c.req.json<{ workspaceId: unknown }>();
    const { workspaceId } = body ?? {};
    if (workspaceId !== null && typeof workspaceId !== "string") {
      return c.json({ error: "Invalid body" }, 400);
    }
    const value = workspaceId === null ? WORKSPACE_COOKIE_CLEARED : workspaceId;
    setCookie(c, WORKSPACE_COOKIE, value, {
      path: "/",
      maxAge: WORKSPACE_COOKIE_MAX_AGE,
      sameSite: "Lax",
      httpOnly: false,
    });
    return c.json({ workspaceId: workspaceId as string | null }, 200);
  })
  .get("/workspaces", async (c) => {
    const db = c.var.db;
    const includeOrphans = c.req.query("include_orphans") === "1";
    const wsRows = await db.query.workspaces.findMany({ orderBy: { createdAt: "asc" } });
    const projectIds = [...new Set(wsRows.map((w) => w.projectId))];
    const projectRows =
      projectIds.length > 0
        ? await db.query.projects.findMany({ columns: { id: true, name: true } })
        : [];
    const projectMap = new Map(projectRows.map((p) => [p.id, p.name]));
    // Mirror the CLI semantics (see `depot workspace list`): orphan
    // workspaces (folder deleted on disk) are hidden by default. Callers
    // can opt in via `?include_orphans=1` to inspect/clean them up; the
    // payload then exposes an `isOrphan` boolean per row so the UI can
    // mark them. Even without opt-in we emit `isOrphan: false` so the
    // field is part of the stable shape and consumers can defensively
    // filter (the WorkspaceSwitcher does).
    const annotated = wsRows.map((ws) => ({
      id: ws.id,
      path: ws.path,
      label: ws.label,
      projectId: ws.projectId,
      projectName: projectMap.get(ws.projectId) ?? ws.projectId,
      isOrphan: !workspaceExistsOnDisk(ws),
    }));
    const workspaces = includeOrphans ? annotated : annotated.filter((ws) => !ws.isOrphan);
    return c.json({ workspaces }, 200);
  })
  .get("/activity", async (c) => {
    const db = c.var.db;
    const wsId = c.var.currentWorkspaceId;
    const repoName = c.req.query("repo") ?? null;

    // Compose the where clause manually so workspace and repo can be combined.
    // The repo filter is exact on the denormalised `repoName`; passing `?repo=`
    // skips historical rows whose attribution is `null` (mono-repo / legacy).
    const where: Record<string, unknown> = {};
    if (wsId) where.workspaceId = wsId;
    if (repoName) where.repoName = repoName;

    const rows = await db.query.activityLog.findMany({
      where: Object.keys(where).length > 0 ? where : undefined,
      orderBy: { createdAt: "desc" },
      limit: 100,
    });

    const prdRevIds = [
      ...new Set(rows.map((r) => r.prdRevisionId).filter((id): id is string => id !== null)),
    ];
    const prdTitleMap = new Map<string, string>();
    if (prdRevIds.length > 0) {
      const prdRows = await db.query.prdRevisions.findMany({ columns: { id: true, title: true } });
      for (const p of prdRows) {
        if (prdRevIds.includes(p.id)) prdTitleMap.set(p.id, p.title);
      }
    }

    const events = rows.map((r) => ({
      id: r.id,
      type: r.eventType,
      prdRevisionId: r.prdRevisionId,
      prdTitle: r.prdRevisionId ? (prdTitleMap.get(r.prdRevisionId) ?? null) : null,
      taskId: r.taskId,
      repoName: r.repoName,
      payload: r.payload,
      createdAt: r.createdAt,
    }));

    return c.json({ events }, 200);
  })
  .get("/sessions/current", (c) => c.json({ session: null }, 200))
  .route("/", prdsRoutes)
  .route("/", pendingActionsRoutes)
  .route("/", projectsRoutes)
  .route("/", docsRoutes)
  .route("/", adrsRoutes)
  .route("/", milestonesRoutes)
  .route("/", prototypesRoutes)
  .route("/", ideasRoutes);

export type AppType = typeof app;
export default app;
