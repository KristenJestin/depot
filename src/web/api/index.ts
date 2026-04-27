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

const app = new Hono<{ Variables: Variables }>()
  .basePath("/api")
  .use("*", async (c, next) => {
    const db = await getDb();
    c.set("db", db);
    c.set("currentWorkspaceId", await resolveWorkspaceHint(db).catch(() => null));
    await next();
  })
  .get("/ping", (c) => c.json({ ok: true }, 200))
  .get("/context", async (c) => {
    const db = c.var.db;
    const wsId = c.var.currentWorkspaceId;

    let workspacePath: string | null = null;
    if (wsId) {
      const ws = await db.query.workspaces.findFirst({
        where: { id: wsId },
        columns: { path: true },
      });
      workspacePath = ws?.path ?? null;
    }

    return c.json({ workspaceId: wsId, workspacePath }, 200);
  })
  .get("/activity", async (c) => {
    const db = c.var.db;
    const wsId = c.var.currentWorkspaceId;

    const rows = await db.query.activityLog.findMany({
      where: wsId ? { workspaceId: wsId } : undefined,
      orderBy: { createdAt: "desc" },
      limit: 100,
    });

    const prdIds = [...new Set(rows.map((r) => r.prdId).filter((id): id is string => id !== null))];
    const prdTitleMap = new Map<string, string>();
    if (prdIds.length > 0) {
      const prdRows = await db.query.prds.findMany({ columns: { id: true, title: true } });
      for (const p of prdRows) {
        if (prdIds.includes(p.id)) prdTitleMap.set(p.id, p.title);
      }
    }

    const events = rows.map((r) => ({
      id: r.id,
      type: r.eventType,
      prdId: r.prdId,
      prdTitle: r.prdId ? (prdTitleMap.get(r.prdId) ?? null) : null,
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
