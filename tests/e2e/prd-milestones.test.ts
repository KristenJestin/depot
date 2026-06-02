import { describe, expect, it } from "vite-plus/test";
import * as Projects from "#/modules/projects/domain";
import * as Prds from "#/modules/prds/domain";
import * as Milestones from "#/modules/prds/milestones";
import * as Activity from "#/modules/activity/domain";
import { isValidMilestone } from "#/shared/validator";
import { getTestDb, runE } from "./helpers";

/**
 * Domain-level unit tests for PRD 0019 / T3 — milestone / `target_version`
 * mechanics. These run with a fresh in-memory DB per test (see
 * `tests/e2e/helpers.ts`'s `beforeEach`), so each case starts from a clean
 * slate without interacting with `tests/e2e/scenarios/*.e2e.test.ts`.
 *
 * Coverage map (7 cases requested by the issue):
 *  1. setMilestone happy path → field updated, activity logged with
 *     previousVersion=null.
 *  2. setMilestone re-set to the same value → no-op silencieux, no
 *     duplicate activity event.
 *  3. setMilestone changing the value → activity logged with the previous
 *     version recorded.
 *  4. unsetMilestone on a PRD without a milestone → no-op (no event).
 *  5. listPrdsByMilestone returns the right PRDs (and only those).
 *  6. summaryByMilestone produces correct counts grouped by status.
 *  7. Validation rejects empty / too-long milestone strings (both branches).
 */

describe("prd milestones (PRD 0019 / T3)", () => {
  it("setMilestone happy path: field updated + activity_log with previousVersion=null", async () => {
    const project = await runE(Projects.createProject({ name: "milestone-happy" }));
    const prd = await runE(Prds.createPrd({ projectId: project.id, title: "First" }));

    const result = await runE(Milestones.setMilestone(prd.id, "2.6"));
    expect(result.changed).toBe(true);
    expect(result.previousVersion).toBeNull();
    expect(result.newVersion).toBe("2.6");

    const db = getTestDb();
    const logical = await db.query.prds.findFirst({ where: { id: prd.prdId } });
    expect(logical?.targetVersion).toBe("2.6");

    const events = await runE(Activity.listActivity({ projectId: project.id }));
    const setEvents = events.filter((e) => e.eventType === "prd_milestone_set");
    expect(setEvents).toHaveLength(1);
    const payload = JSON.parse(setEvents[0]!.payload) as Record<string, unknown>;
    expect(payload["prdId"]).toBe(prd.prdId);
    expect(payload["previousVersion"]).toBeNull();
    expect(payload["newVersion"]).toBe("2.6");
  });

  it("setMilestone re-set to the same value is a silent no-op (no duplicate log)", async () => {
    const project = await runE(Projects.createProject({ name: "milestone-idempotent" }));
    const prd = await runE(Prds.createPrd({ projectId: project.id, title: "Idempotent" }));

    await runE(Milestones.setMilestone(prd.id, "2.7"));
    const second = await runE(Milestones.setMilestone(prd.id, "2.7"));
    expect(second.changed).toBe(false);
    expect(second.previousVersion).toBe("2.7");
    expect(second.newVersion).toBe("2.7");

    const events = await runE(Activity.listActivity({ projectId: project.id }));
    const setEvents = events.filter((e) => e.eventType === "prd_milestone_set");
    expect(setEvents).toHaveLength(1);
  });

  it("setMilestone changing the value logs activity with the correct previousVersion", async () => {
    const project = await runE(Projects.createProject({ name: "milestone-change" }));
    const prd = await runE(Prds.createPrd({ projectId: project.id, title: "Changing" }));

    await runE(Milestones.setMilestone(prd.id, "2.6"));
    const second = await runE(Milestones.setMilestone(prd.id, "2.7"));
    expect(second.changed).toBe(true);
    expect(second.previousVersion).toBe("2.6");
    expect(second.newVersion).toBe("2.7");

    const events = await runE(Activity.listActivity({ projectId: project.id }));
    const setEvents = events.filter((e) => e.eventType === "prd_milestone_set");
    expect(setEvents).toHaveLength(2);
    const secondPayload = JSON.parse(setEvents[1]!.payload) as Record<string, unknown>;
    // Insertion-ordered listing: index [1] should be the most-recent set.
    expect(secondPayload["previousVersion"]).toBe("2.6");
    expect(secondPayload["newVersion"]).toBe("2.7");
  });

  it("unsetMilestone on a PRD without a milestone is a silent no-op", async () => {
    const project = await runE(Projects.createProject({ name: "milestone-unset-noop" }));
    const prd = await runE(Prds.createPrd({ projectId: project.id, title: "Unset noop" }));

    const result = await runE(Milestones.unsetMilestone(prd.id));
    expect(result.changed).toBe(false);
    expect(result.previousVersion).toBeNull();

    const events = await runE(Activity.listActivity({ projectId: project.id }));
    const unsetEvents = events.filter((e) => e.eventType === "prd_milestone_unset");
    expect(unsetEvents).toHaveLength(0);
  });

  it("listPrdsByMilestone returns only the PRDs targeting the given milestone", async () => {
    const project = await runE(Projects.createProject({ name: "milestone-list" }));
    const prdA = await runE(Prds.createPrd({ projectId: project.id, title: "A" }));
    const prdB = await runE(Prds.createPrd({ projectId: project.id, title: "B" }));
    const prdC = await runE(Prds.createPrd({ projectId: project.id, title: "C" }));

    await runE(Milestones.setMilestone(prdA.id, "2.6"));
    await runE(Milestones.setMilestone(prdB.id, "2.6"));
    await runE(Milestones.setMilestone(prdC.id, "2.7"));

    const v26 = await runE(Milestones.listPrdsByMilestone(project.id, "2.6"));
    const v27 = await runE(Milestones.listPrdsByMilestone(project.id, "2.7"));
    const vMissing = await runE(Milestones.listPrdsByMilestone(project.id, "3.0"));

    const idsForV26 = v26.map((p) => p.id).sort();
    const idsForV27 = v27.map((p) => p.id).sort();
    expect(idsForV26).toEqual([prdA.id, prdB.id].sort());
    expect(idsForV27).toEqual([prdC.id]);
    expect(vMissing).toHaveLength(0);
  });

  it("summaryByMilestone returns counts grouped by PRD status", async () => {
    const project = await runE(Projects.createProject({ name: "milestone-summary" }));
    const draftPrd = await runE(Prds.createPrd({ projectId: project.id, title: "Draft" }));
    const readyPrd = await runE(Prds.createPrd({ projectId: project.id, title: "Ready" }));
    const canceledPrd = await runE(Prds.createPrd({ projectId: project.id, title: "Canceled" }));

    await runE(Milestones.setMilestone(draftPrd.id, "2.6"));
    await runE(Milestones.setMilestone(readyPrd.id, "2.6"));
    await runE(Milestones.setMilestone(canceledPrd.id, "2.6"));

    await runE(Prds.markPrdReady(readyPrd.id));
    await runE(Prds.cancelPrd(canceledPrd.id));

    const summary = await runE(Milestones.summaryByMilestone(project.id, "2.6"));
    expect(summary.version).toBe("2.6");
    expect(summary.total).toBe(3);
    expect(summary.byStatus.draft).toBe(1);
    expect(summary.byStatus.ready).toBe(1);
    expect(summary.byStatus.canceled).toBe(1);
    expect(summary.byStatus.in_progress).toBe(0);
    expect(summary.byStatus.review).toBe(0);
    expect(summary.byStatus.done).toBe(0);
  });

  it("validation rejects empty and over-50-chars milestone strings", async () => {
    expect(isValidMilestone("")).toBe(false);
    expect(isValidMilestone("   ")).toBe(false);
    expect(isValidMilestone("x".repeat(51))).toBe(false);
    expect(isValidMilestone("2.6")).toBe(true);
    expect(isValidMilestone("x".repeat(50))).toBe(true);

    const project = await runE(Projects.createProject({ name: "milestone-validation" }));
    const prd = await runE(Prds.createPrd({ projectId: project.id, title: "V" }));

    await expect(runE(Milestones.setMilestone(prd.id, ""))).rejects.toThrow(
      /Milestone must be non-empty/i,
    );
    await expect(runE(Milestones.setMilestone(prd.id, "x".repeat(51)))).rejects.toThrow(
      /longer than the 50-character limit/i,
    );
  });
});
