import { Hono } from "hono";
import * as DomainPending from "#/modules/pending/domain";
import { getRuntime } from "#/services/database";
import type { Variables } from "./types";

export const pendingActionsRoutes = new Hono<{ Variables: Variables }>()
  .get("/projects/:id/pending-actions", async (c) => {
    const { id } = c.req.param();
    const statusQuery = c.req.query("status");
    const status =
      statusQuery === "pending" || statusQuery === "consumed" || statusQuery === "dismissed"
        ? statusQuery
        : "pending";
    const items = await getRuntime().runPromise(DomainPending.listPendingActions(id, { status }));
    return c.json({ items }, 200);
  })
  .post("/projects/:id/pending-actions", async (c) => {
    const { id } = c.req.param();
    type Body = {
      kind?: string;
      slashCommand?: string;
      humanReadableLabel?: string;
      payload?: Record<string, unknown>;
      sourcePrdId?: string;
    };
    const body = (await c.req.json()) as Body;
    if (!body.kind || !body.slashCommand || !body.humanReadableLabel) {
      return c.json({ error: "kind, slashCommand and humanReadableLabel are required" }, 422);
    }
    const validKinds: ReadonlyArray<string> = [
      "advance-phase",
      "resume-with-review",
      "run-doc-sync",
      "run-ship",
      "submit-review",
      "custom",
    ];
    if (!validKinds.includes(body.kind)) {
      return c.json({ error: `Unknown kind: ${body.kind}` }, 422);
    }
    const item = await getRuntime().runPromise(
      DomainPending.pushPendingAction({
        projectId: id,
        kind: body.kind as Parameters<typeof DomainPending.pushPendingAction>[0]["kind"],
        slashCommand: body.slashCommand,
        humanReadableLabel: body.humanReadableLabel,
        payload: body.payload,
        sourcePrdId: body.sourcePrdId,
      }),
    );
    return c.json({ item }, 201);
  })
  .delete("/projects/:id/pending-actions/:actionId", async (c) => {
    const { actionId } = c.req.param();
    const item = await getRuntime().runPromise(DomainPending.dismissPendingAction(actionId));
    if (!item) return c.json({ error: "Not found" }, 404);
    return c.json({ item }, 200);
  });
