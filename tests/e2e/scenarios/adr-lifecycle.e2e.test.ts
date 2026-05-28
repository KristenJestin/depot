import { describe, it } from "vite-plus/test";
import { e2eScenario } from "../runtime";

/**
 * PRD 0016 / T1 — ADR lifecycle.
 *
 * Exercises `adr create / list / accept / supersede` end-to-end and pins
 * two cross-entity guards:
 *  - re-superseding an already-superseded ADR is rejected;
 *  - linking an ADR to a PRD that lives in another project is rejected
 *    (`CrossEntityError`).
 *
 * The `--prd` flag on `adr create` takes the *logical* PRD id (the `prdId`
 * field on a revision row), not the revision id. `prd create` returns the
 * revision; we extract `payload.item.prdId` to get the logical id needed by
 * the ADR.
 *
 * Numbering: ADR numbers are contiguous per project (`ADR-0001`, `ADR-0002`,
 * …). `supersede` allocates a fresh number for the replacement, so the third
 * ADR in a single project lands at `ADR-0003`.
 */

type PrdEnvelope = { item: { id: string; prdId: string; projectId: string } };

type AdrEnvelope = {
  item: {
    id: string;
    number: number;
    title: string;
    status: string;
    prdId: string | null;
    supersededByAdrId: string | null;
  };
  displayId: string;
};

type AdrListEnvelope = {
  items: ReadonlyArray<{ id: string; number: number; title: string; status: string }>;
};

type SupersedePayload = {
  oldAdr: { id: string; status: string; number: number; supersededByAdrId: string | null };
  newAdr: { id: string; status: string; number: number; supersededByAdrId: string | null };
  oldDisplayId: string;
  newDisplayId: string;
};

describe("e2e ADR lifecycle (PRD 0016 / T1)", () => {
  it("A/B/C/D/E/F — create, list, accept, supersede, re-supersede rejection", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("adr-lifecycle");
      await ctx.agent.run("depot init adr-lifecycle", { cwd: repo });

      const prd = await ctx.agent.runJson<PrdEnvelope>(
        "depot --json prd create --title 'Backend choice'",
        { cwd: repo },
      );
      const logicalPrdId = prd.item.prdId;

      // A — first ADR is ADR-0001, no PRD link.
      const adr1 = await ctx.agent.runJson<AdrEnvelope>(
        "depot --json adr create --title 'Use SQLite' --body 'Because it is embedded'",
        { cwd: repo },
      );
      if (adr1.displayId !== "ADR-0001") {
        throw new Error(`expected ADR-0001, got ${adr1.displayId}`);
      }
      if (adr1.item.status !== "proposed") {
        throw new Error(`expected status=proposed on fresh ADR, got '${adr1.item.status}'`);
      }
      if (adr1.item.prdId !== null) {
        throw new Error(`expected prdId=null on unlinked ADR, got ${adr1.item.prdId}`);
      }

      // B — second ADR linked to the PRD's logical id, lands at ADR-0002.
      const adr2 = await ctx.agent.runJson<AdrEnvelope>(
        `depot --json adr create --title 'Connection pooling' --body 'Use WAL' --prd ${logicalPrdId}`,
        { cwd: repo },
      );
      if (adr2.displayId !== "ADR-0002") {
        throw new Error(`expected ADR-0002, got ${adr2.displayId}`);
      }
      if (adr2.item.prdId !== logicalPrdId) {
        throw new Error(`expected ADR-0002.prdId=${logicalPrdId}, got ${adr2.item.prdId}`);
      }

      // C — `adr list --status proposed` returns exactly the two we created,
      // both still in `proposed`.
      const listed = await ctx.agent.runJson<AdrListEnvelope>(
        "depot --json adr list --status proposed",
        { cwd: repo },
      );
      if (listed.items.length !== 2) {
        throw new Error(`expected 2 proposed ADRs, got ${listed.items.length}`);
      }
      for (const it of listed.items) {
        if (it.status !== "proposed") {
          throw new Error(`expected status=proposed in list output, got '${it.status}'`);
        }
      }

      // D — accept ADR-0001 → status flips to `accepted` in DB.
      await ctx.agent.run(`depot adr accept ${adr1.item.id}`, { cwd: repo });
      ctx.expect.dbRow("adrs", { id: adr1.item.id, status: "accepted" });

      // E — supersede ADR-0001 with a new (third) ADR. The new ADR lands at
      // ADR-0003 in `accepted`; the old ADR flips to `superseded` and
      // points at the new one.
      const sup = await ctx.agent.runJson<SupersedePayload>(
        `depot --json adr supersede ${adr1.item.id} --title 'Use Postgres' --body 'Scale concerns'`,
        { cwd: repo },
      );
      if (sup.newDisplayId !== "ADR-0003") {
        throw new Error(`expected new ADR to be ADR-0003, got ${sup.newDisplayId}`);
      }
      if (sup.newAdr.status !== "accepted") {
        throw new Error(`expected new ADR status=accepted, got '${sup.newAdr.status}'`);
      }
      if (sup.oldAdr.status !== "superseded") {
        throw new Error(`expected old ADR status=superseded, got '${sup.oldAdr.status}'`);
      }
      if (sup.oldAdr.supersededByAdrId !== sup.newAdr.id) {
        throw new Error(
          `expected old.supersededByAdrId=${sup.newAdr.id}, got ${sup.oldAdr.supersededByAdrId}`,
        );
      }
      ctx.expect.dbRow("adrs", {
        id: adr1.item.id,
        status: "superseded",
        superseded_by_adr_id: sup.newAdr.id,
      });

      // F — re-superseding an already-superseded ADR is rejected.
      const repeated = await ctx.agent.run(
        `depot adr supersede ${adr1.item.id} --title 'Use DuckDB' --body 'no'`,
        { cwd: repo, expectExit: "any" },
      );
      if (repeated.exitCode === 0) {
        throw new Error(`expected non-zero exit when re-superseding, got 0`);
      }
      ctx.expect.contains(repeated.stderr, "already superseded");
    }, "adr A–F");
  });

  it("G — cross-project ADR linkage is rejected", async () => {
    await e2eScenario(async (ctx) => {
      const repoA = await ctx.git.initRepo("project-a");
      const repoB = await ctx.git.initRepo("project-b");

      await ctx.agent.run("depot init project-a", { cwd: repoA });
      await ctx.agent.run("depot init project-b", { cwd: repoB });

      const prdB = await ctx.agent.runJson<PrdEnvelope>(
        "depot --json prd create --title 'PRD in B'",
        { cwd: repoB },
      );
      const otherProjectPrdId = prdB.item.prdId;

      // From repoA's workspace, link to a PRD whose project is repoB → rejected.
      const result = await ctx.agent.run(
        `depot adr create --title 'X' --body 'Y' --prd ${otherProjectPrdId}`,
        { cwd: repoA, expectExit: "any" },
      );
      if (result.exitCode === 0) {
        throw new Error(`expected non-zero exit for cross-project ADR creation, got 0`);
      }
      ctx.expect.contains(result.stderr, "does not belong to project");
    }, "adr G — cross-project rejection");
  });
});
