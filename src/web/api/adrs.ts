import { Hono } from "hono";

import * as DomainAdrs from "#/modules/adrs/domain";
import { getRuntime } from "#/services/database";
import { VALID_ADR_STATUSES, type AdrStatus } from "#/shared/validator";
import type { Variables } from "./types";

export const adrsRoutes = new Hono<{ Variables: Variables }>()
  .get("/projects/:projectId/adrs", async (c) => {
    const { projectId } = c.req.param();
    const prdIdQuery = c.req.query("prdId");
    const statusQuery = c.req.query("status");
    if (statusQuery !== undefined && !VALID_ADR_STATUSES.includes(statusQuery as AdrStatus)) {
      return c.json(
        { error: `Unknown status: ${statusQuery}`, allowed: [...VALID_ADR_STATUSES] },
        400,
      );
    }
    const items = await getRuntime().runPromise(
      DomainAdrs.listAdrs({
        projectId,
        ...(prdIdQuery !== undefined ? { prdId: prdIdQuery } : {}),
        ...(statusQuery !== undefined ? { status: statusQuery as AdrStatus } : {}),
      }),
    );
    return c.json({ items }, 200);
  })
  .get("/adrs/:id", async (c) => {
    const { id } = c.req.param();
    const view = await getRuntime().runPromise(DomainAdrs.getAdr(id));
    if (!view) return c.json({ error: "Not found" }, 404);
    return c.json(view, 200);
  });
