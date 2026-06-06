import { Hono } from "hono";

import { getRuntime } from "#/services/database";
import * as DomainMilestones from "#/modules/prds/milestones";
import type { Variables } from "./types";

/**
 * Milestone surface (PRD 0019 / T4).
 *
 * Single read endpoint that powers the `/milestones/<v>` page: returns the
 * list of head PRD revisions targeting a given version plus a per-status
 * breakdown computed by `summaryByMilestone`. Scoped to the workspace's
 * project via the cookie middleware so a cross-project name collision (two
 * projects both shipping `2.6.1`) doesn't blur results.
 */

export const milestonesRoutes = new Hono<{ Variables: Variables }>().get(
  "/milestones/:version",
  async (c) => {
    const { version } = c.req.param();
    const db = c.var.db;
    const wsId = c.var.currentWorkspaceId;

    let projectId: string | null = null;
    if (wsId) {
      const ws = await db.query.workspaces.findFirst({
        where: { id: wsId },
        columns: { projectId: true },
      });
      projectId = ws?.projectId ?? null;
    }
    if (!projectId) {
      return c.json({ items: [], summary: { version, total: 0, byStatus: {} } }, 200);
    }

    const items = await getRuntime().runPromise(
      DomainMilestones.listPrdsByMilestone(projectId, version),
    );
    const summary = await getRuntime().runPromise(
      DomainMilestones.summaryByMilestone(projectId, version),
    );
    return c.json({ items, summary }, 200);
  },
);
