import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createTestDb, makeRun } from "../helpers/db";
import { createProject } from "#/modules/projects/domain";
import { createPrd, forkPrd, loadPrdBatch, markPrdReady } from "#/modules/prds/domain";
import {
  addAnnex,
  extractAnnexRefs,
  getAnnex,
  listAnnexes,
  removeAnnex,
} from "#/modules/prds/annexes";
import { ANNEX_CONTENT_MAX_BYTES } from "#/shared/validator";
import type { Database } from "#/db/client";

/**
 * PRD 0024 / T1 — unit coverage for the annex domain.
 *
 *   1. name / kind / content / description validation.
 *   2. add → list → get → remove round-trip.
 *   3. replace semantics (existing name fails without --replace, overwrites with).
 *   4. fork copies annexes; editing the new revision's annex leaves the old.
 *   5. extractAnnexRefs over 0 / 1 / N refs, malformed ignored, dedup.
 */
describe("prd_annexes domain (PRD 0024 / T1)", () => {
  let db: Database;
  let run: ReturnType<typeof makeRun>;
  let projectId: string;

  beforeEach(async () => {
    db = createTestDb().db;
    run = makeRun(db);
    projectId = (await run(createProject({ name: "annexes" }))).id;
  });

  it("rejects malformed name / kind / empty + oversized content / long description", async () => {
    const prd = await run(createPrd({ projectId, title: "X" }));

    await expect(
      run(addAnnex(prd.id, { name: "Bad Name", kind: "html", content: "<p>x</p>" })),
    ).rejects.toThrow(/kebab-case/);
    await expect(
      run(addAnnex(prd.id, { name: "-leading", kind: "html", content: "<p>x</p>" })),
    ).rejects.toThrow(/kebab-case/);
    await expect(
      run(addAnnex(prd.id, { name: "", kind: "html", content: "<p>x</p>" })),
    ).rejects.toThrow(/must not be empty/);
    const tooLongName = "a".repeat(61);
    await expect(
      run(addAnnex(prd.id, { name: tooLongName, kind: "html", content: "<p>x</p>" })),
    ).rejects.toThrow(/at most 60/);

    await expect(
      // @ts-expect-error: deliberately invalid kind
      run(addAnnex(prd.id, { name: "proto", kind: "pdf", content: "<p>x</p>" })),
    ).rejects.toThrow(/Invalid annex kind/);

    await expect(
      run(addAnnex(prd.id, { name: "proto", kind: "html", content: "" })),
    ).rejects.toThrow(/must not be empty/);

    const oversized = "a".repeat(ANNEX_CONTENT_MAX_BYTES + 1);
    await expect(
      run(addAnnex(prd.id, { name: "proto", kind: "text", content: oversized })),
    ).rejects.toThrow(/2 MB/);

    const longDesc = "d".repeat(501);
    await expect(
      run(
        addAnnex(prd.id, {
          name: "proto",
          kind: "html",
          description: longDesc,
          content: "<p>x</p>",
        }),
      ),
    ).rejects.toThrow(/at most 500/);

    expect(await run(listAnnexes(prd.id))).toEqual([]);
  });

  it("add → list → get → remove round-trip", async () => {
    const prd = await run(createPrd({ projectId, title: "X" }));

    const added = await run(
      addAnnex(prd.id, {
        name: "pointage-factures",
        kind: "html",
        description: "prototype du pointage de factures",
        content: "<html><body>proto</body></html>",
      }),
    );
    expect(added.name).toBe("pointage-factures");
    expect(added.kind).toBe("html");
    expect(added.prdRevisionId).toBe(prd.id);

    const list = await run(listAnnexes(prd.id));
    expect(list.map((a) => a.name)).toEqual(["pointage-factures"]);

    const fetched = await run(getAnnex(added.id));
    expect(fetched.content).toBe("<html><body>proto</body></html>");
    expect(fetched.description).toBe("prototype du pointage de factures");

    const removed = await run(removeAnnex(added.id));
    expect(removed.id).toBe(added.id);
    expect(await run(listAnnexes(prd.id))).toEqual([]);

    await expect(run(getAnnex(added.id))).rejects.toThrow(/Annex not found/);
    await expect(run(removeAnnex(added.id))).rejects.toThrow(/Annex not found/);
  });

  it("list is sorted by name and getAnnex on an unknown id fails", async () => {
    const prd = await run(createPrd({ projectId, title: "X" }));
    await run(addAnnex(prd.id, { name: "zeta", kind: "text", content: "z" }));
    await run(addAnnex(prd.id, { name: "alpha", kind: "text", content: "a" }));
    await run(addAnnex(prd.id, { name: "mu", kind: "text", content: "m" }));
    expect((await run(listAnnexes(prd.id))).map((a) => a.name)).toEqual(["alpha", "mu", "zeta"]);
    await expect(run(getAnnex("does-not-exist"))).rejects.toThrow(/Annex not found/);
  });

  it("replace semantics: existing name fails, --replace overwrites in place", async () => {
    const prd = await run(createPrd({ projectId, title: "X" }));
    const first = await run(
      addAnnex(prd.id, { name: "proto", kind: "html", content: "<p>v1</p>", description: "first" }),
    );

    await expect(
      run(addAnnex(prd.id, { name: "proto", kind: "html", content: "<p>v2</p>" })),
    ).rejects.toThrow(/already exists/);

    const replaced = await run(
      addAnnex(prd.id, {
        name: "proto",
        kind: "markdown",
        content: "# v2",
        description: "second",
        replace: true,
      }),
    );
    expect(replaced.id).toBe(first.id);
    expect(replaced.kind).toBe("markdown");
    expect(replaced.content).toBe("# v2");
    expect(replaced.description).toBe("second");

    const list = await run(listAnnexes(prd.id));
    expect(list).toHaveLength(1);
    expect(list[0]!.content).toBe("# v2");
  });

  it("fork copies annexes; editing the new revision does not touch the old", async () => {
    const { prd } = await run(
      loadPrdBatch({
        projectId,
        title: "Fork annex PRD",
        ready: true,
        tasks: [],
      }),
    );
    const original = await run(
      addAnnex(prd.id, { name: "proto", kind: "html", content: "<p>original</p>" }),
    );

    const forked = await run(forkPrd(prd.id));
    const forkedAnnexes = await run(listAnnexes(forked.id));
    expect(forkedAnnexes.map((a) => a.name)).toEqual(["proto"]);
    const copy = forkedAnnexes[0]!;
    expect(copy.id).not.toBe(original.id);
    expect(copy.content).toBe("<p>original</p>");

    await run(
      addAnnex(forked.id, {
        name: "proto",
        kind: "html",
        content: "<p>edited fork</p>",
        replace: true,
      }),
    );

    const oldAnnex = await run(getAnnex(original.id));
    expect(oldAnnex.content).toBe("<p>original</p>");
    const newAnnex = await run(getAnnex(copy.id));
    expect(newAnnex.content).toBe("<p>edited fork</p>");
  });

  it("markPrdReady then fork still copies annexes (created on a draft, forked from ready)", async () => {
    const prd = await run(createPrd({ projectId, title: "X" }));
    await run(addAnnex(prd.id, { name: "sample", kind: "text", content: "data" }));
    await run(markPrdReady(prd.id));
    const forked = await run(forkPrd(prd.id));
    expect((await run(listAnnexes(forked.id))).map((a) => a.name)).toEqual(["sample"]);
  });

  it("extractAnnexRefs handles 0 / 1 / N, ignores malformed, dedups", () => {
    expect(extractAnnexRefs(null)).toEqual([]);
    expect(extractAnnexRefs("")).toEqual([]);
    expect(extractAnnexRefs("no refs here")).toEqual([]);

    expect(extractAnnexRefs("see [annex: proto] for the layout")).toEqual(["proto"]);
    expect(extractAnnexRefs("[annex:  spaced-name ]")).toEqual([]);
    expect(extractAnnexRefs("[annex: spaced-name]")).toEqual(["spaced-name"]);

    expect(extractAnnexRefs("[annex: alpha] and [annex: beta] and again [annex: alpha]")).toEqual([
      "alpha",
      "beta",
    ]);

    // Malformed: uppercase / spaces inside the slug → not captured.
    expect(extractAnnexRefs("[annex: Bad Name] [annex: UPPER]")).toEqual([]);
    expect(extractAnnexRefs("[annex:]")).toEqual([]);
  });
});
