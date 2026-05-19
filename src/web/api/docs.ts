import { Hono } from "hono";
import * as DomainDocs from "#/modules/docs/domain";
import * as DomainDocSync from "#/modules/docs/sync";
import { getRuntime } from "#/services/database";
import type { DocKind } from "#/shared/validator";
import type { Variables } from "./types";

export const docsRoutes = new Hono<{ Variables: Variables }>()
  .get("/projects/:id/docs", async (c) => {
    const { id } = c.req.param();
    const kindQuery = c.req.query("kind") as DocKind | undefined;
    const artifacts = await getRuntime().runPromise(
      DomainDocs.listDocArtifacts(id, { kind: kindQuery }),
    );
    const profiles = await getRuntime().runPromise(DomainDocSync.listProfiles(id));
    // Latest sync run per profile for the read-only "Sync history" pane.
    const lastRunsByProfile: Record<string, unknown> = {};
    for (const p of profiles) {
      const runs = await getRuntime().runPromise(DomainDocSync.listSyncRuns(p.id, { limit: 5 }));
      lastRunsByProfile[p.id] = runs;
    }
    return c.json({ artifacts, profiles, lastRunsByProfile }, 200);
  })
  .get("/prds/:id/docs", async (c) => {
    const { id } = c.req.param();
    const db = c.var.db;
    const items = await db.query.docArtifacts.findMany({
      where: { linkedPrdRevisionId: id },
    });
    return c.json({ items }, 200);
  });
