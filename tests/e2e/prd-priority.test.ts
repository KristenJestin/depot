import { describe, expect, it } from "vite-plus/test";
import * as Projects from "#/modules/projects/domain";
import * as Prds from "#/modules/prds/domain";
import * as Priority from "#/modules/prds/priority";
import * as Activity from "#/modules/activity/domain";
import { isValidPrdPriority } from "#/shared/validator";
import { getTestDb, runE } from "./helpers";

/**
 * Domain-level unit tests for PRD 0019 / T5 — product priority mechanics.
 * Each test starts from a fresh in-memory DB (`beforeEach` in helpers.ts).
 *
 * Coverage map (6 cases requested by the issue):
 *  1. setPriority happy path → field updated, activity_log loggé.
 *  2. setPriority re-set to the same value → no-op silencieux, no duplicate log.
 *  3. setPriority changing the value → activity_log with previousPriority correct.
 *  4. Validation rejects invalid priority values.
 *  5. listPrdsByPriority filters correctly.
 *  6. createPrd accepts priority at creation.
 */

describe("prd priority (PRD 0019 / T5)", () => {
  it("setPriority happy path: field updated + activity_log with previousPriority='normal'", async () => {
    const project = await runE(Projects.createProject({ name: "priority-happy" }));
    const prd = await runE(Prds.createPrd({ projectId: project.id, title: "First" }));

    const result = await runE(Priority.setPriority(prd.id, "high"));
    expect(result.changed).toBe(true);
    expect(result.previousPriority).toBe("normal");
    expect(result.newPriority).toBe("high");

    const db = getTestDb();
    const logical = await db.query.prds.findFirst({ where: { id: prd.prdId } });
    expect(logical?.priority).toBe("high");

    const events = await runE(Activity.listActivity({ projectId: project.id }));
    const priorityEvents = events.filter((e) => e.eventType === "prd_priority_changed");
    expect(priorityEvents).toHaveLength(1);
    const payload = JSON.parse(priorityEvents[0]!.payload) as Record<string, unknown>;
    expect(payload["prdId"]).toBe(prd.prdId);
    expect(payload["previousPriority"]).toBe("normal");
    expect(payload["newPriority"]).toBe("high");
  });

  it("setPriority re-set to the same value is a silent no-op (no duplicate log)", async () => {
    const project = await runE(Projects.createProject({ name: "priority-idempotent" }));
    const prd = await runE(Prds.createPrd({ projectId: project.id, title: "Idem" }));

    await runE(Priority.setPriority(prd.id, "critical"));
    const second = await runE(Priority.setPriority(prd.id, "critical"));
    expect(second.changed).toBe(false);
    expect(second.previousPriority).toBe("critical");
    expect(second.newPriority).toBe("critical");

    const events = await runE(Activity.listActivity({ projectId: project.id }));
    const priorityEvents = events.filter((e) => e.eventType === "prd_priority_changed");
    expect(priorityEvents).toHaveLength(1);
  });

  it("setPriority changing the value logs activity with the correct previousPriority", async () => {
    const project = await runE(Projects.createProject({ name: "priority-change" }));
    const prd = await runE(Prds.createPrd({ projectId: project.id, title: "Move" }));

    await runE(Priority.setPriority(prd.id, "high"));
    const second = await runE(Priority.setPriority(prd.id, "critical"));
    expect(second.changed).toBe(true);
    expect(second.previousPriority).toBe("high");
    expect(second.newPriority).toBe("critical");

    const events = await runE(Activity.listActivity({ projectId: project.id }));
    const priorityEvents = events.filter((e) => e.eventType === "prd_priority_changed");
    expect(priorityEvents).toHaveLength(2);
    const secondPayload = JSON.parse(priorityEvents[1]!.payload) as Record<string, unknown>;
    expect(secondPayload["previousPriority"]).toBe("high");
    expect(secondPayload["newPriority"]).toBe("critical");
  });

  it("validation rejects an invalid priority enum value", async () => {
    expect(isValidPrdPriority("critical")).toBe(true);
    expect(isValidPrdPriority("urgent")).toBe(false);
    expect(isValidPrdPriority("")).toBe(false);
    expect(isValidPrdPriority(null)).toBe(false);

    const project = await runE(Projects.createProject({ name: "priority-validation" }));
    const prd = await runE(Prds.createPrd({ projectId: project.id, title: "V" }));

    await expect(runE(Priority.setPriority(prd.id, "urgent" as never))).rejects.toThrow(
      /Invalid priority/,
    );
  });

  it("listPrdsByPriority returns only the PRDs that carry the given priority", async () => {
    const project = await runE(Projects.createProject({ name: "priority-list" }));
    const prdA = await runE(Prds.createPrd({ projectId: project.id, title: "A" }));
    const prdB = await runE(Prds.createPrd({ projectId: project.id, title: "B" }));
    const prdC = await runE(Prds.createPrd({ projectId: project.id, title: "C" }));

    await runE(Priority.setPriority(prdA.id, "critical"));
    await runE(Priority.setPriority(prdB.id, "critical"));
    await runE(Priority.setPriority(prdC.id, "low"));

    const critical = await runE(Priority.listPrdsByPriority(project.id, "critical"));
    const low = await runE(Priority.listPrdsByPriority(project.id, "low"));
    const normal = await runE(Priority.listPrdsByPriority(project.id, "normal"));

    const critIds = critical.map((p) => p.id).sort();
    expect(critIds).toEqual([prdA.id, prdB.id].sort());
    expect(low.map((p) => p.id)).toEqual([prdC.id]);
    expect(normal).toHaveLength(0);
  });

  it("createPrd accepts an initial priority at creation time", async () => {
    const project = await runE(Projects.createProject({ name: "priority-create" }));
    const prd = await runE(
      Prds.createPrd({ projectId: project.id, title: "Created hot", priority: "high" }),
    );

    const db = getTestDb();
    const logical = await db.query.prds.findFirst({ where: { id: prd.prdId } });
    expect(logical?.priority).toBe("high");

    // No `prd_priority_changed` event for a creation-time priority (the
    // priority was never "changed" — it shipped as `high` from the start).
    const events = await runE(Activity.listActivity({ projectId: project.id }));
    const priorityEvents = events.filter((e) => e.eventType === "prd_priority_changed");
    expect(priorityEvents).toHaveLength(0);
  });
});
