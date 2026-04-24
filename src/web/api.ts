import { Hono } from "hono";
import type { Database } from "#/db/client";

export type Variables = {
  db: Database;
  currentWorkspaceId: string | null;
};

const app = new Hono<{ Variables: Variables }>().basePath("/api");

app.get("/ping", (c) => {
  return c.json({ ok: true });
});

app.get("/context", (c) => {
  const workspaceId = c.get("currentWorkspaceId") ?? null;
  return c.json({ workspaceId });
});

export default app;
