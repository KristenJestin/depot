import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createTestDb, makeRun } from "../helpers/db";
import { createProject } from "#/modules/projects/domain";
import { createPrd } from "#/modules/prds/domain";
import {
  addTag,
  listAllTagsForProject,
  listPrdsForTag,
  listTagsForPrd,
  removeTag,
} from "#/modules/prds/tags";
import type { Database } from "#/db/client";

/**
 * PRD 0019 / T1 — unit coverage for the tag domain. Five scenarios:
 *   1. addTag happy path + idempotent on repeat insertion.
 *   2. addTag rejects malformed tags (uppercase, special chars, empty, >50).
 *   3. removeTag is a no-op for an absent tag.
 *   4. listTagsForPrd returns alphabetically-sorted tags.
 *   5. listPrdsForTag returns every head revision carrying the tag.
 */
describe("prd_tags domain (PRD 0019 / T1)", () => {
  let db: Database;
  let run: ReturnType<typeof makeRun>;
  let projectId: string;

  beforeEach(async () => {
    db = createTestDb().db;
    run = makeRun(db);
    projectId = (await run(createProject({ name: "tags" }))).id;
  });

  it("addTag inserts a valid tag and is idempotent on a duplicate", async () => {
    const prd = await run(createPrd({ projectId, title: "X" }));
    const first = await run(addTag(prd.id, "agent-friendliness"));
    expect(first.tag).toBe("agent-friendliness");
    expect(first.prdId).toBe(prd.prdId);

    const second = await run(addTag(prd.id, "agent-friendliness"));
    expect(second.prdId).toBe(first.prdId);
    expect(second.tag).toBe(first.tag);

    const tags = await run(listTagsForPrd(prd.id));
    expect(tags).toEqual(["agent-friendliness"]);
  });

  it("addTag rejects malformed tags (uppercase, special chars, empty, >50)", async () => {
    const prd = await run(createPrd({ projectId, title: "X" }));
    await expect(run(addTag(prd.id, "Uppercase"))).rejects.toThrow(/kebab-case/);
    await expect(run(addTag(prd.id, "has space"))).rejects.toThrow(/kebab-case/);
    await expect(run(addTag(prd.id, "-leading-dash"))).rejects.toThrow(/kebab-case/);
    await expect(run(addTag(prd.id, ""))).rejects.toThrow(/empty/);
    const tooLong = "a".repeat(51);
    await expect(run(addTag(prd.id, tooLong))).rejects.toThrow(/at most 50/);

    expect(await run(listTagsForPrd(prd.id))).toEqual([]);
  });

  it("removeTag is a no-op when the tag is not attached", async () => {
    const prd = await run(createPrd({ projectId, title: "X" }));
    await expect(run(removeTag(prd.id, "not-there"))).resolves.toEqual({
      prdId: prd.prdId,
    });
    expect(await run(listTagsForPrd(prd.id))).toEqual([]);

    await run(addTag(prd.id, "zeta"));
    await run(removeTag(prd.id, "zeta"));
    await run(removeTag(prd.id, "zeta"));
    expect(await run(listTagsForPrd(prd.id))).toEqual([]);
  });

  it("listTagsForPrd returns tags sorted alphabetically", async () => {
    const prd = await run(createPrd({ projectId, title: "X" }));
    await run(addTag(prd.id, "zeta"));
    await run(addTag(prd.id, "alpha"));
    await run(addTag(prd.id, "mu"));
    expect(await run(listTagsForPrd(prd.id))).toEqual(["alpha", "mu", "zeta"]);
  });

  it("listPrdsForTag returns the head revisions carrying the tag", async () => {
    const prdA = await run(createPrd({ projectId, title: "A" }));
    const prdB = await run(createPrd({ projectId, title: "B" }));
    const prdC = await run(createPrd({ projectId, title: "C" }));

    await run(addTag(prdA.id, "shared"));
    await run(addTag(prdB.id, "shared"));
    await run(addTag(prdA.id, "only-a"));
    await run(addTag(prdC.id, "other"));

    const shared = await run(listPrdsForTag(projectId, "shared"));
    expect(shared.map((r) => r.id).sort()).toEqual([prdA.id, prdB.id].sort());

    const onlyA = await run(listPrdsForTag(projectId, "only-a"));
    expect(onlyA.map((r) => r.id)).toEqual([prdA.id]);

    const missing = await run(listPrdsForTag(projectId, "nope"));
    expect(missing).toEqual([]);

    expect(await run(listAllTagsForProject(projectId))).toEqual(["only-a", "other", "shared"]);
  });
});
