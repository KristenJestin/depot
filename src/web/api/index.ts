import { Hono } from "hono";

import { getDb } from "#/services/database";
import { normalizeWorkspacePath } from "#/shared/utils";
import type { Database } from "#/db/client";
import type { Variables } from "./types";
import { prdsRoutes } from "./prds";

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

// In-memory override; undefined = fall back to cwd resolution, null = no workspace
let workspaceOverride: string | null | undefined = undefined;

const app = new Hono<{ Variables: Variables }>()
  .basePath("/api")
  .use("*", async (c, next) => {
    const db = await getDb();
    c.set("db", db);
    const wsId =
      workspaceOverride !== undefined
        ? workspaceOverride
        : await resolveWorkspaceHint(db).catch(() => null);
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
    workspaceOverride = workspaceId as string | null;
    return c.json({ workspaceId: workspaceOverride }, 200);
  })
  .get("/workspaces", async (c) => {
    const db = c.var.db;
    const wsRows = await db.query.workspaces.findMany({ orderBy: { createdAt: "asc" } });
    const projectIds = [...new Set(wsRows.map((w) => w.projectId))];
    const projectRows =
      projectIds.length > 0
        ? await db.query.projects.findMany({ columns: { id: true, name: true } })
        : [];
    const projectMap = new Map(projectRows.map((p) => [p.id, p.name]));
    const workspaces = wsRows.map((ws) => ({
      id: ws.id,
      path: ws.path,
      label: ws.label,
      projectId: ws.projectId,
      projectName: projectMap.get(ws.projectId) ?? ws.projectId,
    }));
    return c.json({ workspaces }, 200);
  })
  .get("/activity", async (c) => {
    const db = c.var.db;
    const wsId = c.var.currentWorkspaceId;

    const rows = await db.query.activityLog.findMany({
      where: wsId ? { workspaceId: wsId } : undefined,
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
      payload: r.payload,
      createdAt: r.createdAt,
    }));

    return c.json({ events }, 200);
  })
  .get("/sessions/current", (c) => c.json({ session: null }, 200))
  .route("/", prdsRoutes);

export type AppType = typeof app;
export default app;
