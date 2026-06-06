import { describe, it } from "vite-plus/test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { e2eScenario } from "../runtime";

/**
 * PRD 0030 — Prototype → dev placement handoff, end-to-end.
 *
 * Reproduces the maintainer's real case ("OT complémentaires"): a PRD whose
 * prototype has **two mono-variant pages** — a `form` page (data entry) and a
 * `list` page (consultation). With a single variant per page there is nothing
 * to elect: each page is **retained by default**, so the only thing left to
 * converge is its per-(round, page) placement. Driven against the real `depot`
 * binary, this exercises the four pieces PRD 0030 ships:
 *
 *  - **Distill per page** (issue 02): `distill <pageId> --spec "…"` writes the
 *    placement onto the CURRENT round's `(round, page)`; the section guard
 *    refuses a spec that lacks `## Regions` / `## Order`.
 *  - **Gate as a fallback** (issue 03): `prd ready` refuses while a decided
 *    page (here mono-variant, retained by default) has no placement in the
 *    current round, naming the offending page, and passes once every shipped
 *    page is distilled.
 *  - **Page ↔ task link** (issue 04): `task page add/list` round-trips the
 *    M:N link, scoped to one task's pages.
 *  - **Round snapshot + inherit/reset** (issue 01/05): opening v2 via
 *    `--from-current` clones the manifest as pointers and INHERITS each page's
 *    placement; iterating one page (`form`) in v2 advances its pin and RESETS
 *    that page's placement in v2 (it must be re-distilled), while the
 *    untouched page (`list`) keeps its inherited placement. v1 stays a frozen,
 *    still-resolvable snapshot throughout.
 *
 * The design-lock gate only runs when a real `--user-confirmed` quote is
 * present (it is skipped under `DEPOT_BYPASS_USER_CONFIRMATION=1`, which the
 * e2e env sets). So the `prd ready` calls below override that env var off and
 * pass a verbatim quote, to actually exercise the gate.
 *
 * Ordering note: `prd ready` transitions the PRD to `ready` (terminal for
 * accepting new tasks / draft-only mutations), so the single SUCCESSFUL ready
 * lands at the very end. Step 4's "passes after distilling both pages" is
 * therefore validated transitively by that terminal ready, after the v2
 * re-distill restores full coverage. The pre-distill REFUSAL is asserted in
 * place (it is non-destructive — the PRD stays draft).
 */

type PrdEnvelope = { item: { id: string } };
type ProtoEnvelope = { item: { id: string; slug: string } };
type PageEnvelope = { item: { id: string; slug: string } };
type VersionEnvelope = { item: { id: string; label: string } };
type VariantEnvelope = { item: { id: string; label: string; isMain: boolean } };
type RoundEnvelope = { item: { id: string; label: string } };
type RoundListEnvelope = {
  items: Array<{ id: string; label: string; pages: number; isCurrent: boolean }>;
};
type TaskEnvelope = { item: { id: string; title: string } };
type TaskPageListEnvelope = { items: Array<{ id: string; slug: string; title: string }> };

const SELF_CONTAINED_HTML = "<!doctype html><html><body><p>variant</p></body></html>";
const FORM_SPEC =
  "## Regions\nHeader, then the input form, then a submit bar.\n\n## Order\nHeader, fields, submit.";
const LIST_SPEC =
  "## Regions\nHeader, then a filter bar, then the rows table.\n\n## Order\nHeader, filters, rows.";
const shellArg = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

describe("e2e prototype placement handoff (PRD 0030)", () => {
  it("two mono-variant pages → distill per page → fallback gate → page↔task link → round snapshot inherit/reset", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("ot-complementaires");
      await ctx.agent.run("depot init ot-complementaires", { cwd: repo });

      // 1 — PRD revision + prototype; round v1 is auto-seeded on create.
      const prd = await ctx.agent.runJson<PrdEnvelope>(
        "depot --json prd create --title 'OT complementaires'",
        { cwd: repo },
      );
      const prdRevisionId = prd.item.id;

      const proto = await ctx.agent.runJson<ProtoEnvelope>(
        `depot --json prd prototype create ${prdRevisionId} ot`,
        { cwd: repo },
      );
      const prototypeId = proto.item.id;

      // 2 — Two mono-variant pages: a `form` (entry) and a `list` (consult),
      // each with one version and one self-contained variant. With a single
      // variant per page there is nothing to elect — both are retained by
      // default. `version add` auto-includes each page's first version into
      // the current round, so v1's manifest lands at 2 pages.
      const assetDir = await ctx.dir.create("proto-assets");
      const htmlPath = join(assetDir, "page.html");
      await writeFile(htmlPath, SELF_CONTAINED_HTML);

      const addPageTree = async (slug: string, title: string) => {
        const page = await ctx.agent.runJson<PageEnvelope>(
          `depot --json prd prototype page add ${prototypeId} --slug ${slug} --title '${title}'`,
          { cwd: repo },
        );
        const version = await ctx.agent.runJson<VersionEnvelope>(
          `depot --json prd prototype version add ${page.item.id} --label it1`,
          { cwd: repo },
        );
        const variant = await ctx.agent.runJson<VariantEnvelope>(
          `depot --json prd prototype variant add ${version.item.id} --label only --title '${title} only' --file ${shellArg(htmlPath)}`,
          { cwd: repo },
        );
        return { pageId: page.item.id, versionId: version.item.id, variantId: variant.item.id };
      };

      const form = await addPageTree("form", "Form");
      const list = await addPageTree("list", "List");

      const afterPages = await ctx.agent.runJson<RoundListEnvelope>(
        `depot --json prd prototype round list ${prototypeId}`,
        { cwd: repo },
      );
      const v1a = afterPages.items.find((r) => r.label === "v1");
      if (!v1a) throw new Error(`expected an auto-seeded round 'v1', got ${labels(afterPages)}`);
      if (!v1a.isCurrent) throw new Error("expected v1 to be the current round after authoring");
      if (v1a.pages !== 2) {
        throw new Error(`expected v1 manifest to hold 2 pages (form + list), got ${v1a.pages}`);
      }
      const v1Id = v1a.id;

      // 3 — Section guard: a spec without `## Regions` / `## Order` is refused
      // and nothing is stored. Probe it on `form` first.
      const guard = await ctx.agent.run(
        `depot prd prototype distill ${form.pageId} --spec 'just prose, no sections'`,
        { cwd: repo, expectExit: "any" },
      );
      if (guard.exitCode === 0) {
        throw new Error(
          `expected the distill section guard to refuse a spec missing Regions/Order, got exit 0\n  stdout: ${guard.stdout}`,
        );
      }
      ctx.expect.contains(guard.stderr, "Regions");
      ctx.expect.contains(guard.stderr, "Order");

      // 4a — Gate refuses while a decided page has no placement. At this point
      // NEITHER page is distilled, so `prd ready` blocks and names both pages.
      const blockedBoth = await ctx.agent.run(
        `depot prd ready ${prdRevisionId} --user-confirmed go`,
        { cwd: repo, expectExit: "any", env: { DEPOT_BYPASS_USER_CONFIRMATION: "0" } },
      );
      if (blockedBoth.exitCode === 0) {
        throw new Error(
          `expected 'prd ready' to be blocked while no page is distilled, got exit 0\n  stdout: ${blockedBoth.stdout}`,
        );
      }
      ctx.expect.contains(blockedBoth.stderr, "page 'form'");
      ctx.expect.contains(blockedBoth.stderr, "page 'list'");
      ctx.expect.contains(blockedBoth.stderr, "no distilled placement");

      // 3b — Distill the `form` page on the current round (v1). Now only `list`
      // is missing a placement.
      await ctx.agent.run(`depot prd prototype distill ${form.pageId} --spec '${FORM_SPEC}'`, {
        cwd: repo,
      });
      ctx.expect.dbRow("prd_round_page_design", {
        round_id: v1Id,
        page_id: form.pageId,
        placement_spec: FORM_SPEC,
      });

      // 4b — Gate still refuses — pointing at the ONLY remaining page (`list`),
      // and no longer at `form` (its placement now exists).
      const blockedList = await ctx.agent.run(
        `depot prd ready ${prdRevisionId} --user-confirmed go`,
        { cwd: repo, expectExit: "any", env: { DEPOT_BYPASS_USER_CONFIRMATION: "0" } },
      );
      if (blockedList.exitCode === 0) {
        throw new Error(
          `expected 'prd ready' to still be blocked with 'list' undistilled, got exit 0\n  stdout: ${blockedList.stdout}`,
        );
      }
      ctx.expect.contains(blockedList.stderr, "page 'list'");
      ctx.expect.notContains(blockedList.stderr, "page 'form'");

      // 3c — Distill `list` too: every shipped page now carries a placement.
      await ctx.agent.run(`depot prd prototype distill ${list.pageId} --spec '${LIST_SPEC}'`, {
        cwd: repo,
      });
      ctx.expect.dbRow("prd_round_page_design", {
        round_id: v1Id,
        page_id: list.pageId,
        placement_spec: LIST_SPEC,
      });

      // 5 — Page ↔ task link: two tasks, link form→A, list→B, and verify the
      // link round-trips and stays scoped (task A sees only `form`). The PRD is
      // still a draft here, which `task add` requires.
      const taskA = await ctx.agent.runJson<TaskEnvelope>(
        `depot --json task add --prd-id ${prdRevisionId} --title 'Build the form' --desc 'Intent: form' --criteria 'form works' --effort s`,
        { cwd: repo },
      );
      const taskB = await ctx.agent.runJson<TaskEnvelope>(
        `depot --json task add --prd-id ${prdRevisionId} --title 'Build the list' --desc 'Intent: list' --criteria 'list works' --effort s`,
        { cwd: repo },
      );

      await ctx.agent.run(`depot task page add ${taskA.item.id} ${form.pageId}`, { cwd: repo });
      await ctx.agent.run(`depot task page add ${taskB.item.id} ${list.pageId}`, { cwd: repo });

      const aPages = await ctx.agent.runJson<TaskPageListEnvelope>(
        `depot --json task page list ${taskA.item.id}`,
        { cwd: repo },
      );
      if (aPages.items.map((p) => p.id).join(",") !== form.pageId) {
        throw new Error(
          `expected task A to link only the form page, got [${aPages.items.map((p) => p.slug).join(", ")}]`,
        );
      }
      const bPages = await ctx.agent.runJson<TaskPageListEnvelope>(
        `depot --json task page list ${taskB.item.id}`,
        { cwd: repo },
      );
      if (bPages.items.map((p) => p.id).join(",") !== list.pageId) {
        throw new Error(
          `expected task B to link only the list page, got [${bPages.items.map((p) => p.slug).join(", ")}]`,
        );
      }
      ctx.expect.dbRow("task_prototype_pages", { task_id: taskA.item.id, page_id: form.pageId });
      ctx.expect.dbRow("task_prototype_pages", { task_id: taskB.item.id, page_id: list.pageId });

      // 6 — Round snapshot. Open v2 by cloning the CURRENT round; v2 inherits
      // both pins AND both placements. v1 stays frozen at 2 pages. We use the
      // `--from-current` shortcut (the feedback ⇒ new round path) directly.
      const v2 = await ctx.agent.runJson<RoundEnvelope>(
        `depot --json prd prototype round add ${prototypeId} --label v2 --from-current`,
        { cwd: repo },
      );
      const v2Id = v2.item.id;
      const afterOpen = await ctx.agent.runJson<RoundListEnvelope>(
        `depot --json prd prototype round list ${prototypeId}`,
        { cwd: repo },
      );
      const v2a = afterOpen.items.find((r) => r.id === v2Id)!;
      if (!v2a.isCurrent) throw new Error("expected v2 to be the current round after add");
      if (v2a.pages !== 2) {
        throw new Error(`expected cloned v2 manifest to hold 2 pages, got ${v2a.pages}`);
      }
      // Both placements were inherited into v2 (the clone pins the same versions).
      ctx.expect.dbRow("prd_round_page_design", {
        round_id: v2Id,
        page_id: form.pageId,
        placement_spec: FORM_SPEC,
      });
      ctx.expect.dbRow("prd_round_page_design", {
        round_id: v2Id,
        page_id: list.pageId,
        placement_spec: LIST_SPEC,
      });

      // Iterate `form` in v2: a new version + variant advances v2's pin in
      // place. Because the pinned version changed, v2's `form` placement RESETS
      // (the placement was about the old variant) — it must be re-distilled.
      // `list` is untouched: its inherited placement stays.
      const formIt2 = await ctx.agent.runJson<VersionEnvelope>(
        `depot --json prd prototype version add ${form.pageId} --label it2`,
        { cwd: repo },
      );
      await ctx.agent.runJson<VariantEnvelope>(
        `depot --json prd prototype variant add ${formIt2.item.id} --label only --title 'Form only v2' --file ${shellArg(htmlPath)}`,
        { cwd: repo },
      );

      // v1 stays a frozen snapshot: it still pins form's it1 version and still
      // carries form's original placement (untouched by the v2 iteration).
      ctx.expect.dbRow("prd_prototype_round_pages", {
        round_id: v1Id,
        page_id: form.pageId,
        page_version_id: form.versionId,
      });
      ctx.expect.dbRow("prd_round_page_design", {
        round_id: v1Id,
        page_id: form.pageId,
        placement_spec: FORM_SPEC,
      });

      // v2's `form` placement was reset (row removed) by the pin advance; its
      // pin now points at the new version. `list` in v2 still has its placement.
      ctx.expect.dbRow("prd_prototype_round_pages", {
        round_id: v2Id,
        page_id: form.pageId,
        page_version_id: formIt2.item.id,
      });
      assertNoRow(ctx, "prd_round_page_design", { round_id: v2Id, page_id: form.pageId });
      ctx.expect.dbRow("prd_round_page_design", {
        round_id: v2Id,
        page_id: list.pageId,
        placement_spec: LIST_SPEC,
      });

      // With v2's `form` placement reset, the gate (current round = v2) refuses
      // again, naming `form` and not `list`.
      const blockedV2 = await ctx.agent.run(
        `depot prd ready ${prdRevisionId} --user-confirmed go`,
        { cwd: repo, expectExit: "any", env: { DEPOT_BYPASS_USER_CONFIRMATION: "0" } },
      );
      if (blockedV2.exitCode === 0) {
        throw new Error(
          `expected 'prd ready' to be blocked after iterating form in v2, got exit 0\n  stdout: ${blockedV2.stdout}`,
        );
      }
      ctx.expect.contains(blockedV2.stderr, "page 'form'");
      ctx.expect.notContains(blockedV2.stderr, "page 'list'");

      // Re-distill `form` in v2 (the current round). Every shipped page in the
      // current round now carries a placement again.
      await ctx.agent.run(`depot prd prototype distill ${form.pageId} --spec '${FORM_SPEC}'`, {
        cwd: repo,
      });
      ctx.expect.dbRow("prd_round_page_design", {
        round_id: v2Id,
        page_id: form.pageId,
        placement_spec: FORM_SPEC,
      });

      // Terminal gate: `prd ready` now passes (every page in the current round
      // is decided-by-default and distilled), transitioning the PRD to `ready`.
      const passed = await ctx.agent.run(`depot prd ready ${prdRevisionId} --user-confirmed go`, {
        cwd: repo,
        expectExit: "any",
        env: { DEPOT_BYPASS_USER_CONFIRMATION: "0" },
      });
      if (passed.exitCode !== 0) {
        throw new Error(
          `expected 'prd ready' to pass once every shipped page is distilled, got exit ${passed.exitCode}\n  stderr: ${passed.stderr}`,
        );
      }
      ctx.expect.dbRow("prd_revisions", { id: prdRevisionId, status: "ready" });
    }, "prototype placement handoff (PRD 0030)");
  }, 120_000);
});

function labels(env: RoundListEnvelope): string {
  return env.items.map((r) => r.label).join(", ");
}

/**
 * Assert that no row matches `where` in `table`. `ctx.expect.dbRow` only
 * asserts presence, so the placement-reset check (the row was deleted) needs
 * its own negative probe. Reuses the same scenario DB.
 */
function assertNoRow(ctx: { root: string }, table: string, where: Record<string, string>): void {
  const dbPath = join(ctx.root, "depot.db");
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const clauses = Object.keys(where)
      .map((col) => `${col} = ?`)
      .join(" AND ");
    const row = db
      .prepare(`SELECT 1 FROM ${table} WHERE ${clauses} LIMIT 1`)
      .get(...Object.values(where));
    if (row) {
      throw new Error(
        `assertNoRow: expected NO row in ${table} matching ${JSON.stringify(where)}, but found one`,
      );
    }
  } finally {
    db.close();
  }
}
