import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createTestDb, makeRun } from "../helpers/db";
import { createProject } from "#/modules/projects/domain";
import { createPrd } from "#/modules/prds/domain";
import {
  createAdr,
  listAdrs,
  getAdr,
  acceptAdr,
  supersedeAdr,
  formatAdrNumber,
} from "#/modules/adrs/domain";
import type { Database } from "#/db/client";

describe("createAdr", () => {
  let db: Database;
  let run: ReturnType<typeof makeRun>;
  let projectId: string;

  beforeEach(async () => {
    db = createTestDb().db;
    run = makeRun(db);
    projectId = (await run(createProject({ name: "p" }))).id;
  });

  it("creates an ADR in 'proposed' status with body and title", async () => {
    const adr = await run(
      createAdr({
        projectId,
        title: "Use SQLite",
        body: "We pick SQLite because it is embedded.",
      }),
    );
    expect(adr.status).toBe("proposed");
    expect(adr.title).toBe("Use SQLite");
    expect(adr.body).toBe("We pick SQLite because it is embedded.");
    expect(adr.projectId).toBe(projectId);
    expect(adr.prdId).toBeNull();
    expect(adr.supersededByAdrId).toBeNull();
  });

  it("assigns contiguous numbers per project starting at 1", async () => {
    const a = await run(createAdr({ projectId, title: "A", body: "..." }));
    const b = await run(createAdr({ projectId, title: "B", body: "..." }));
    const c = await run(createAdr({ projectId, title: "C", body: "..." }));
    expect(a.number).toBe(1);
    expect(b.number).toBe(2);
    expect(c.number).toBe(3);
  });

  it("counts numbers independently per project", async () => {
    const other = (await run(createProject({ name: "other" }))).id;
    const a = await run(createAdr({ projectId, title: "A", body: "x" }));
    const b = await run(createAdr({ projectId: other, title: "B", body: "y" }));
    expect(a.number).toBe(1);
    expect(b.number).toBe(1);
  });

  it("rejects an empty title", async () => {
    await expect(run(createAdr({ projectId, title: "", body: "x" }))).rejects.toThrow(
      /title.*non-empty|title.*empty|non-empty.*title/i,
    );
  });

  it("rejects an empty body", async () => {
    await expect(run(createAdr({ projectId, title: "t", body: "  " }))).rejects.toThrow(
      /body.*non-empty|body.*empty|non-empty.*body/i,
    );
  });

  it("accepts an optional prdId from the same project", async () => {
    const prd = await run(createPrd({ projectId, title: "feature" }));
    const adr = await run(createAdr({ projectId, prdId: prd.prdId, title: "t", body: "b" }));
    expect(adr.prdId).toBe(prd.prdId);
  });

  it("rejects a prdId that belongs to another project", async () => {
    const other = (await run(createProject({ name: "other" }))).id;
    const foreignPrd = await run(createPrd({ projectId: other, title: "x" }));
    await expect(
      run(createAdr({ projectId, prdId: foreignPrd.prdId, title: "t", body: "b" })),
    ).rejects.toThrow(/does not belong to project|same project/i);
  });

  it("rejects a non-existent prdId", async () => {
    await expect(
      run(createAdr({ projectId, prdId: "nonexistent", title: "t", body: "b" })),
    ).rejects.toThrow(/PRD not found|not found/i);
  });
});

describe("formatAdrNumber", () => {
  it("zero-pads to four digits", () => {
    expect(formatAdrNumber(1)).toBe("ADR-0001");
    expect(formatAdrNumber(42)).toBe("ADR-0042");
    expect(formatAdrNumber(9999)).toBe("ADR-9999");
  });
});

describe("listAdrs", () => {
  let db: Database;
  let run: ReturnType<typeof makeRun>;
  let projectId: string;
  let otherProjectId: string;

  beforeEach(async () => {
    db = createTestDb().db;
    run = makeRun(db);
    projectId = (await run(createProject({ name: "p" }))).id;
    otherProjectId = (await run(createProject({ name: "p2" }))).id;
  });

  it("returns an empty list when nothing exists", async () => {
    const list = await run(listAdrs({ projectId }));
    expect(list).toEqual([]);
  });

  it("filters by project", async () => {
    await run(createAdr({ projectId, title: "A", body: "x" }));
    await run(createAdr({ projectId: otherProjectId, title: "B", body: "y" }));
    const list = await run(listAdrs({ projectId }));
    expect(list).toHaveLength(1);
    expect(list[0]!.title).toBe("A");
  });

  it("filters by prdId", async () => {
    const prd = await run(createPrd({ projectId, title: "feature" }));
    await run(createAdr({ projectId, prdId: prd.prdId, title: "linked", body: "x" }));
    await run(createAdr({ projectId, title: "unlinked", body: "y" }));
    const list = await run(listAdrs({ projectId, prdId: prd.prdId }));
    expect(list).toHaveLength(1);
    expect(list[0]!.title).toBe("linked");
  });

  it("filters by status", async () => {
    const a = await run(createAdr({ projectId, title: "A", body: "x" }));
    await run(createAdr({ projectId, title: "B", body: "y" }));
    await run(acceptAdr(a.id));
    const accepted = await run(listAdrs({ projectId, status: "accepted" }));
    expect(accepted).toHaveLength(1);
    expect(accepted[0]!.title).toBe("A");
    const proposed = await run(listAdrs({ projectId, status: "proposed" }));
    expect(proposed).toHaveLength(1);
    expect(proposed[0]!.title).toBe("B");
  });

  it("orders by number ascending", async () => {
    await run(createAdr({ projectId, title: "first", body: "x" }));
    await run(createAdr({ projectId, title: "second", body: "y" }));
    await run(createAdr({ projectId, title: "third", body: "z" }));
    const list = await run(listAdrs({ projectId }));
    expect(list.map((a) => a.number)).toEqual([1, 2, 3]);
  });
});

describe("getAdr", () => {
  let db: Database;
  let run: ReturnType<typeof makeRun>;
  let projectId: string;

  beforeEach(async () => {
    db = createTestDb().db;
    run = makeRun(db);
    projectId = (await run(createProject({ name: "p" }))).id;
  });

  it("returns null for unknown id", async () => {
    const adr = await run(getAdr("nope"));
    expect(adr).toBeNull();
  });

  it("returns the ADR with supersedes info", async () => {
    const created = await run(createAdr({ projectId, title: "t", body: "b" }));
    const got = await run(getAdr(created.id));
    expect(got).not.toBeNull();
    expect(got!.adr.id).toBe(created.id);
    expect(got!.supersededBy).toBeNull();
    expect(got!.supersedes).toBeNull();
  });

  it("includes supersedes info after a supersede", async () => {
    const old = await run(createAdr({ projectId, title: "old", body: "b" }));
    await run(acceptAdr(old.id));
    const result = await run(supersedeAdr(old.id, { title: "new", body: "b2" }));

    const oldView = await run(getAdr(old.id));
    expect(oldView!.adr.status).toBe("superseded");
    expect(oldView!.supersededBy?.id).toBe(result.newAdr.id);

    const newView = await run(getAdr(result.newAdr.id));
    expect(newView!.adr.status).toBe("accepted");
    expect(newView!.supersedes?.id).toBe(old.id);
  });
});

describe("acceptAdr", () => {
  let db: Database;
  let run: ReturnType<typeof makeRun>;
  let projectId: string;

  beforeEach(async () => {
    db = createTestDb().db;
    run = makeRun(db);
    projectId = (await run(createProject({ name: "p" }))).id;
  });

  it("transitions proposed -> accepted", async () => {
    const adr = await run(createAdr({ projectId, title: "t", body: "b" }));
    const updated = await run(acceptAdr(adr.id));
    expect(updated.status).toBe("accepted");
  });

  it("rejects if ADR is already accepted", async () => {
    const adr = await run(createAdr({ projectId, title: "t", body: "b" }));
    await run(acceptAdr(adr.id));
    await expect(run(acceptAdr(adr.id))).rejects.toThrow(/transition.*'accepted' -> 'accepted'/);
  });

  it("rejects if ADR is superseded", async () => {
    const old = await run(createAdr({ projectId, title: "old", body: "b" }));
    await run(acceptAdr(old.id));
    await run(supersedeAdr(old.id, { title: "new", body: "b2" }));
    await expect(run(acceptAdr(old.id))).rejects.toThrow(/transition.*'superseded'/);
  });

  it("rejects for unknown ADR", async () => {
    await expect(run(acceptAdr("nope"))).rejects.toThrow(/ADR not found|not found/i);
  });
});

describe("supersedeAdr", () => {
  let db: Database;
  let run: ReturnType<typeof makeRun>;
  let projectId: string;

  beforeEach(async () => {
    db = createTestDb().db;
    run = makeRun(db);
    projectId = (await run(createProject({ name: "p" }))).id;
  });

  it("creates a new accepted ADR and marks the old one superseded atomically", async () => {
    const old = await run(createAdr({ projectId, title: "old", body: "b" }));
    await run(acceptAdr(old.id));

    const result = await run(supersedeAdr(old.id, { title: "new", body: "b2" }));
    expect(result.newAdr.status).toBe("accepted");
    expect(result.newAdr.number).toBe(2);
    expect(result.newAdr.projectId).toBe(projectId);
    expect(result.oldAdr.status).toBe("superseded");
    expect(result.oldAdr.supersededByAdrId).toBe(result.newAdr.id);
  });

  it("works on a proposed ADR too", async () => {
    const old = await run(createAdr({ projectId, title: "old", body: "b" }));
    const result = await run(supersedeAdr(old.id, { title: "new", body: "b2" }));
    expect(result.oldAdr.status).toBe("superseded");
    expect(result.newAdr.status).toBe("accepted");
  });

  it("rejects superseding an already-superseded ADR", async () => {
    const old = await run(createAdr({ projectId, title: "old", body: "b" }));
    await run(supersedeAdr(old.id, { title: "mid", body: "b2" }));
    await expect(run(supersedeAdr(old.id, { title: "newer", body: "b3" }))).rejects.toThrow(
      /already superseded|superseded.*ADR/i,
    );
  });

  it("rejects unknown ADR", async () => {
    await expect(run(supersedeAdr("nope", { title: "x", body: "y" }))).rejects.toThrow(
      /ADR not found|not found/i,
    );
  });

  it("rejects empty title or body on the new ADR", async () => {
    const old = await run(createAdr({ projectId, title: "old", body: "b" }));
    await expect(run(supersedeAdr(old.id, { title: "", body: "x" }))).rejects.toThrow(
      /title.*non-empty|non-empty.*title/i,
    );
    await expect(run(supersedeAdr(old.id, { title: "x", body: "" }))).rejects.toThrow(
      /body.*non-empty|non-empty.*body/i,
    );
  });

  it("inherits prdId on the new ADR when given", async () => {
    const prd = await run(createPrd({ projectId, title: "feature" }));
    const old = await run(createAdr({ projectId, title: "old", body: "b" }));
    const result = await run(supersedeAdr(old.id, { title: "new", body: "b2", prdId: prd.prdId }));
    expect(result.newAdr.prdId).toBe(prd.prdId);
  });
});
