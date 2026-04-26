import { Hono } from "hono";
import { desc } from "drizzle-orm";

import { prds as prdsTable } from "#/db/schema";
import type { Variables } from "./types";

export const prdsRoutes = new Hono<{ Variables: Variables }>()
  .get("/prds", async (c) => {
    const prds = await c.var.db.select().from(prdsTable).orderBy(desc(prdsTable.updatedAt));
    return c.json({ prds }, 200);
  })
  .get("/prds/:id", async (c) => {
    const db = c.var.db;
    const { id } = c.req.param();

    const prd = await db.query.prds.findFirst({
      where: { id },
    });
    if (!prd) return c.json({ error: "Not found" }, 404);

    const tasks = await db.query.tasks.findMany({
      where: { prdId: id, reviewId: { isNull: true } },
      orderBy: (t, { asc }) => [asc(t.position)],
    });

    const latestReview = await db.query.reviews.findFirst({
      where: { prdId: id },
      orderBy: (r, { desc }) => [desc(r.createdAt)],
    });

    const findings = latestReview
      ? await db.query.tasks.findMany({
          where: { reviewId: latestReview.id },
          orderBy: (t, { asc }) => [asc(t.position)],
        })
      : [];

    const review = latestReview
      ? { type: latestReview.type, status: latestReview.status, findings }
      : null;

    return c.json({ prd, tasks, review }, 200);
  });
