import { Hono } from "hono";

import * as DomainIdeas from "#/modules/ideas/domain";
import * as DomainPrds from "#/modules/prds/domain";
import { getRuntime } from "#/services/database";
import { invalidTagReason, VALID_IDEA_STATUSES, type IdeaStatus } from "#/shared/validator";
import type { Variables } from "./types";

/**
 * Web API for the idea-capture subsystem (PRD 0027 / T7). Strictly read-only —
 * ideas mutate via the CLI only (cf. the PRD's read-only-web-UI decision).
 *
 *   - `GET /api/projects/:projectId/ideas[?status=&tag=&mapped=]` — list a
 *     project's ideas newest-first, plus the project's open-idea count for the
 *     recall badge. Default status is `open` (mirrors the domain default).
 *     `mapped=true|false` keeps only ideas that are / are not linked to a PRD.
 *   - `GET /api/ideas/:id` — a single idea (404 when missing).
 *
 * Every idea is decorated with `linkedPrds` — the head revisions of the PRDs
 * that reference it as source material (`prd_ideas`). This makes the M:N
 * reference visible from the *idea* side; the inverse (a PRD's source ideas) is
 * surfaced on the PRD-detail payload (`prds.ts`), mirroring how annexes are
 * attached there. A `revisionId` lets the UI link to a `/prds/:id` page that
 * actually loads (that route resolves a PRD *revision* id).
 */
type LinkedPrd = { revisionId: string; prdId: string; title: string };

/**
 * Resolve the head-revision PRDs that reference an idea as source material,
 * shaped for the UI. `listIdeaPrds` already returns the current revision row of
 * each linked logical PRD (newest-link-first), so we just project the fields
 * the UI links on.
 */
const linkedPrdsFor = async (ideaId: string): Promise<LinkedPrd[]> => {
  const rows = await getRuntime().runPromise(DomainIdeas.listIdeaPrds(ideaId));
  return rows.map((r) => ({ revisionId: r.id, prdId: r.prdId, title: r.title }));
};

export const ideasRoutes = new Hono<{ Variables: Variables }>()
  .get("/projects/:projectId/ideas", async (c) => {
    const { projectId } = c.req.param();
    const statusQuery = c.req.query("status");
    const tagQuery = c.req.query("tag");
    const mappedQuery = c.req.query("mapped");
    if (statusQuery !== undefined && !VALID_IDEA_STATUSES.includes(statusQuery as IdeaStatus)) {
      return c.json(
        { error: `Unknown status: ${statusQuery}`, allowed: [...VALID_IDEA_STATUSES] },
        400,
      );
    }
    if (tagQuery !== undefined && tagQuery.length > 0) {
      const reason = invalidTagReason(tagQuery);
      if (reason !== null) return c.json({ error: reason }, 400);
    }

    const rows = await getRuntime().runPromise(
      DomainIdeas.listIdeas(projectId, {
        ...(statusQuery !== undefined ? { status: statusQuery as IdeaStatus } : {}),
        ...(tagQuery ? { tag: tagQuery } : {}),
      }),
    );
    // `promotedPrdId` is the *logical* PRD id, but the web `/prds/:id` route
    // resolves a PRD *revision* id. Decorate each promoted idea with the head
    // revision id (the logical PRD's `currentRevisionId`) so the UI can link to
    // a page that actually loads, mirroring the dependency decoration in prds.ts.
    // `linkedPrds` exposes the M:N `prd_ideas` reference from the idea side.
    let ideas = await Promise.all(
      rows.map(async (idea) => {
        let promotedPrdRevisionId: string | null = null;
        if (idea.promotedPrdId) {
          const logical = await getRuntime().runPromise(
            DomainPrds.getLogicalPrd(idea.promotedPrdId),
          );
          promotedPrdRevisionId = logical?.currentRevisionId ?? null;
        }
        const linkedPrds = await linkedPrdsFor(idea.id);
        return { ...idea, promotedPrdRevisionId, linkedPrds };
      }),
    );
    // `mapped` filters *after* decoration: an idea is "mapped" iff it has ≥1
    // linked PRD. Composes with status/tag (those already narrowed `rows`).
    if (mappedQuery === "true") ideas = ideas.filter((i) => i.linkedPrds.length > 0);
    else if (mappedQuery === "false") ideas = ideas.filter((i) => i.linkedPrds.length === 0);
    // The open count is project-wide (independent of the active status/tag/mapped
    // filter) so the recall badge stays stable while the user browses.
    const open = await getRuntime().runPromise(
      DomainIdeas.listIdeas(projectId, { status: "open" }),
    );
    return c.json({ ideas, openCount: open.length }, 200);
  })
  .get("/ideas/:id", async (c) => {
    const { id } = c.req.param();
    try {
      const idea = await getRuntime().runPromise(DomainIdeas.getIdea(id));
      let promotedPrdRevisionId: string | null = null;
      if (idea.promotedPrdId) {
        const logical = await getRuntime().runPromise(DomainPrds.getLogicalPrd(idea.promotedPrdId));
        promotedPrdRevisionId = logical?.currentRevisionId ?? null;
      }
      const linkedPrds = await linkedPrdsFor(idea.id);
      return c.json({ idea: { ...idea, promotedPrdRevisionId, linkedPrds } }, 200);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/not found/i.test(msg)) return c.json({ error: msg }, 404);
      return c.json({ error: msg }, 422);
    }
  });
