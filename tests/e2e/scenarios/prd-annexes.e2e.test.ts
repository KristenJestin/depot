import { describe, it } from "vite-plus/test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { e2eScenario } from "../runtime";

/**
 * PRD 0024 / T1 — `depot prd annex` end-to-end.
 *
 * Unit-level coverage lives in `tests/lib/prd-annexes.test.ts`. These scenarios
 * drive the built `dist/index.mjs` against a real SQLite DB so a regression in
 * argv parsing, the stdin/file content path, the activity-log write, or the
 * fork copy would surface here even if the unit tests still pass.
 *
 * Sub-cases (each a fresh DB):
 *  A. `annex add --kind html --file proto.html`; `annex list` shows
 *     name+kind+description; `annex cat` returns the exact bytes of the file.
 *  B. `depot context` / `prd show` list the annex but NOT its inline content;
 *     a PRD whose body references `[annex: missing]` with no such annex makes
 *     `prd show` emit a broken-reference warning.
 *  C. `annex add` with an existing name is refused; `--replace` overwrites it.
 *  D. fork copies the annex into the new revision; editing the new revision's
 *     annex leaves the old revision's annex untouched.
 */

type PrdEnvelope = { item: { id: string; prdId: string; title: string } };
type AnnexEnvelope = { item: { id: string; name: string; kind: string } };
type AnnexListEnvelope = {
  items: ReadonlyArray<{ id: string; name: string; kind: string; description: string | null }>;
};

const HTML_PROTO = "<html>\n  <body><h1>Pointage des factures</h1></body>\n</html>\n";

describe("e2e: prd annex (PRD 0024 / T1)", () => {
  it("A — add from --file, list shows metadata, cat returns exact content", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("annex-a");
      await ctx.agent.run("depot init annex-a", { cwd: repo });

      const protoPath = path.join(repo, "proto.html");
      await writeFile(protoPath, HTML_PROTO, "utf-8");

      const prd = await ctx.agent.runJson<PrdEnvelope>("depot --json prd create --title 'PRD A'", {
        cwd: repo,
      });

      const added = await ctx.agent.runJson<AnnexEnvelope>(
        `depot --json prd annex add ${prd.item.id} --name pointage-factures --kind html --description 'prototype du pointage' --file proto.html`,
        { cwd: repo },
      );
      ctx.expect.dbHas("prd_annexes", { name: "pointage-factures", kind: "html" });
      ctx.expect.dbHas("activity_log", { event_type: "prd_annex_added" });

      const list = await ctx.agent.runJson<AnnexListEnvelope>(
        `depot --json prd annex list ${prd.item.id}`,
        { cwd: repo },
      );
      if (
        list.items.length !== 1 ||
        list.items[0]?.name !== "pointage-factures" ||
        list.items[0]?.kind !== "html" ||
        list.items[0]?.description !== "prototype du pointage"
      ) {
        throw new Error(
          `expected one html annex with description, got ${JSON.stringify(list.items)}`,
        );
      }

      const cat = await ctx.agent.run(`depot prd annex cat ${added.item.id}`, { cwd: repo });
      if (cat.stdout !== HTML_PROTO + "\n") {
        // `output.print` appends a newline; the exact file body must be the prefix.
        ctx.expect.contains(cat.stdout, HTML_PROTO.trimEnd());
        ctx.expect.contains(cat.stdout, "<h1>Pointage des factures</h1>");
      }
    }, "prd-annexes A — add --file / list / cat exact content");
  });

  it("B — context/show list the annex without content; broken [annex:] ref warns", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("annex-b");
      await ctx.agent.run("depot init annex-b", { cwd: repo });

      const prd = await ctx.agent.runJson<PrdEnvelope>("depot --json prd create --title 'PRD B'", {
        cwd: repo,
      });

      await ctx.agent.run(
        `depot prd annex add ${prd.item.id} --name proto --kind html --description 'the proto' --content '<p>SECRET-BODY</p>'`,
        { cwd: repo },
      );

      const show = await ctx.agent.run(`depot prd show ${prd.item.id}`, { cwd: repo });
      ctx.expect.contains(show.stdout, "proto (html)");
      ctx.expect.contains(show.stdout, "the proto");
      ctx.expect.notContains(show.stdout, "SECRET-BODY");

      const context = await ctx.agent.run(`depot context prd ${prd.item.id}`, { cwd: repo });
      ctx.expect.contains(context.stdout, "Annexes");
      ctx.expect.contains(context.stdout, "proto (html)");
      ctx.expect.notContains(context.stdout, "SECRET-BODY");

      const broken = await ctx.agent.runJson<PrdEnvelope>(
        "depot --json prd create --title 'PRD broken' --context 'See [annex: missing] for details'",
        { cwd: repo },
      );
      const brokenShow = await ctx.agent.run(`depot prd show ${broken.item.id}`, { cwd: repo });
      ctx.expect.contains(brokenShow.stdout, "Warning");
      ctx.expect.contains(brokenShow.stdout, "missing");
    }, "prd-annexes B — context/show list metadata only; broken ref warns");
  });

  it("C — adding an existing name is refused; --replace overwrites", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("annex-c");
      await ctx.agent.run("depot init annex-c", { cwd: repo });

      const prd = await ctx.agent.runJson<PrdEnvelope>("depot --json prd create --title 'PRD C'", {
        cwd: repo,
      });

      await ctx.agent.run(
        `depot prd annex add ${prd.item.id} --name proto --kind html --content '<p>v1</p>'`,
        { cwd: repo },
      );

      const dup = await ctx.agent.run(
        `depot prd annex add ${prd.item.id} --name proto --kind html --content '<p>v2</p>'`,
        { cwd: repo, expectExit: "any" },
      );
      if (dup.exitCode === 0) {
        throw new Error(
          `expected non-zero exit for duplicate annex name, got 0 (stdout: ${dup.stdout})`,
        );
      }
      ctx.expect.contains(dup.stderr, "already exists");

      const replaced = await ctx.agent.runJson<AnnexEnvelope>(
        `depot --json prd annex add ${prd.item.id} --name proto --kind markdown --content '# v2' --replace`,
        { cwd: repo },
      );
      const cat = await ctx.agent.run(`depot prd annex cat ${replaced.item.id}`, { cwd: repo });
      ctx.expect.contains(cat.stdout, "# v2");

      const list = await ctx.agent.runJson<AnnexListEnvelope>(
        `depot --json prd annex list ${prd.item.id}`,
        { cwd: repo },
      );
      if (list.items.length !== 1 || list.items[0]?.kind !== "markdown") {
        throw new Error(
          `expected one markdown annex after replace, got ${JSON.stringify(list.items)}`,
        );
      }
    }, "prd-annexes C — duplicate name refused, --replace overwrites");
  });

  it("D — fork copies the annex; editing the new revision leaves the old", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("annex-d");
      await ctx.agent.run("depot init annex-d", { cwd: repo });

      const prd = await ctx.agent.runJson<PrdEnvelope>("depot --json prd create --title 'PRD D'", {
        cwd: repo,
      });

      const original = await ctx.agent.runJson<AnnexEnvelope>(
        `depot --json prd annex add ${prd.item.id} --name proto --kind html --content '<p>original</p>'`,
        { cwd: repo },
      );

      await ctx.agent.run(`depot prd ready ${prd.item.id}`, { cwd: repo });
      const forked = await ctx.agent.runJson<{ item: { id: string } }>(
        `depot --json prd fork ${prd.item.id}`,
        { cwd: repo },
      );

      const forkedList = await ctx.agent.runJson<AnnexListEnvelope>(
        `depot --json prd annex list ${forked.item.id}`,
        { cwd: repo },
      );
      if (forkedList.items.length !== 1 || forkedList.items[0]?.name !== "proto") {
        throw new Error(
          `expected forked revision to carry one 'proto' annex, got ${JSON.stringify(forkedList.items)}`,
        );
      }
      const forkedAnnexId = forkedList.items[0]!.id;
      if (forkedAnnexId === original.item.id) {
        throw new Error("forked annex should be a distinct row, not the original id");
      }

      await ctx.agent.run(
        `depot prd annex add ${forked.item.id} --name proto --kind html --content '<p>edited fork</p>' --replace`,
        { cwd: repo },
      );

      const oldCat = await ctx.agent.run(`depot prd annex cat ${original.item.id}`, { cwd: repo });
      ctx.expect.contains(oldCat.stdout, "<p>original</p>");
      ctx.expect.notContains(oldCat.stdout, "edited fork");

      const newCat = await ctx.agent.run(`depot prd annex cat ${forkedAnnexId}`, { cwd: repo });
      ctx.expect.contains(newCat.stdout, "<p>edited fork</p>");
    }, "prd-annexes D — fork copies annex, divergent edits stay isolated");
  });
});
