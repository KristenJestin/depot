import { Hono } from "hono";
import { desc } from "drizzle-orm";

import { prds as prdsTable } from "#/db/schema";
import type { Variables } from "./types";

export const prdsRoutes = new Hono<{ Variables: Variables }>().get("/prds", async (c) => {
  const prds = await c.var.db.select().from(prdsTable).orderBy(desc(prdsTable.updatedAt));
  return c.json({ prds }, 200);
});
