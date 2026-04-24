import { Hono } from "hono";

import { openDatabase, defaultDbPath } from "#/db/client";
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

export function createApp(db: Database) {
  return new Hono<{ Variables: Variables }>()
    .basePath("/api")
    .use("*", async (c, next) => {
      c.set("db", db);
      c.set("currentWorkspaceId", await resolveWorkspaceHint(db).catch(() => null));
      await next();
    })
    .get("/ping", (c) => c.json({ ok: true }, 200))
    .get("/context", (c) => c.json({ workspaceId: c.var.currentWorkspaceId }, 200))
    .route("/", prdsRoutes);
}

const _db = process.env["VITEST"] ? null : openDatabase(defaultDbPath()).db;
const routes = createApp(_db!);

export type AppType = typeof routes;

export default routes;
