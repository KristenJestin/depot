import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createTestDb, makeRun } from "../helpers/db";
import { renderTemplate } from "#/modules/context/renderer";
import { createDirective, updateDirective } from "#/modules/projects/directives";
import { createProject } from "#/modules/projects/domain";
import type { Database } from "#/db/client";

describe("renderTemplate (PRD 0013 / T2)", () => {
  let db: Database;
  let run: ReturnType<typeof makeRun>;
  let projectId: string;

  beforeEach(async () => {
    db = createTestDb().db;
    run = makeRun(db);
    projectId = (await run(createProject({ name: "test" }))).id;
  });

  it("returns the template unchanged when it has no markers", async () => {
    const tpl = "# Title\n\nNo markers here at all.\n\n- Bullet\n";
    const out = await run(renderTemplate(tpl, projectId));
    expect(out).toBe(tpl);
  });

  it("substitutes a {{hooks}} marker with the empty placeholder when no directive matches", async () => {
    const tpl = "before\n{{hooks scope=post-auditor-pass category=dev}}\nafter\n";
    const out = await run(renderTemplate(tpl, projectId));
    expect(out).toBe("before\n_No project hooks at this stage._\nafter\n");
  });

  it("substitutes a {{directives}} marker with the empty placeholder when no directive matches", async () => {
    const tpl = "before\n{{directives scope=always category=dev}}\nafter\n";
    const out = await run(renderTemplate(tpl, projectId));
    expect(out).toBe("before\n_No project directives at this stage._\nafter\n");
  });

  it("renders a single blocking rule directive under the hooks heading", async () => {
    await run(
      createDirective({
        projectId,
        scope: "post-auditor-pass",
        category: "dev",
        kind: "rule",
        title: "Run tester skill",
        instruction: "Spawn the tester sub-agent and loop back to coder if KO.",
      }),
    );
    const tpl = "{{hooks scope=post-auditor-pass category=dev}}";
    const out = await run(renderTemplate(tpl, projectId));
    expect(out).toContain("### Project hooks at this stage (post-auditor-pass)");
    expect(out).toContain("You MUST follow these project-specific hooks before proceeding.");
    expect(out).toContain("They are declared by the project itself.");
    expect(out).toContain("1. **Run tester skill** [blocking rule]");
    expect(out).toContain("Spawn the tester sub-agent and loop back to coder if KO.");
    expect(out).not.toContain("Run: `");
  });

  it("renders mixed directives (rule + command, blocking + advisory) with the right tags", async () => {
    await run(
      createDirective({
        projectId,
        scope: "post-auditor-pass",
        category: "dev",
        kind: "rule",
        title: "Mandatory loop",
        instruction: "Loop back to coder on auditor KO.",
        blocking: true,
      }),
    );
    await run(
      createDirective({
        projectId,
        scope: "post-auditor-pass",
        category: "dev",
        kind: "command",
        title: "Run tester",
        instruction: "bun run tester",
        blocking: false,
        repoTarget: "api",
      }),
    );
    await run(
      createDirective({
        projectId,
        scope: "post-auditor-pass",
        category: "dev",
        kind: "command",
        title: "Smoke check",
        instruction: "bun run smoke",
        blocking: true,
      }),
    );
    const tpl = "{{hooks scope=post-auditor-pass category=dev}}";
    const out = await run(renderTemplate(tpl, projectId));
    expect(out).toContain("1. **Mandatory loop** [blocking rule]");
    expect(out).toContain("2. **Run tester** [advisory command]");
    expect(out).toContain("Run: `bun run tester` (in api)");
    expect(out).toContain("3. **Smoke check** [blocking command]");
    expect(out).toContain("Run: `bun run smoke`");
    expect(out).not.toContain("Run: `bun run smoke` (in auto)");
    expect(out).not.toContain("Run: `bun run smoke` (in )");
  });

  it("uses the ground-rules heading for {{directives scope=always}}", async () => {
    await run(
      createDirective({
        projectId,
        scope: "always",
        category: "dev",
        kind: "rule",
        title: "Be polite",
        instruction: "Stay professional in every commit message.",
      }),
    );
    const tpl = "{{directives scope=always category=dev}}";
    const out = await run(renderTemplate(tpl, projectId));
    expect(out).toContain("### Project ground rules (always)");
    expect(out).toContain("These ground rules apply throughout your work.");
    expect(out).not.toContain("Project hooks at this stage");
    expect(out).toContain("1. **Be polite** [blocking rule]");
  });

  it("uses the hooks heading even for a non-always scope with the hooks marker", async () => {
    await run(
      createDirective({
        projectId,
        scope: "pre-commit",
        category: "coder",
        kind: "rule",
        title: "Run check",
        instruction: "Run bun run check before any commit.",
      }),
    );
    const tpl = "{{hooks scope=pre-commit category=coder}}";
    const out = await run(renderTemplate(tpl, projectId));
    expect(out).toContain("### Project hooks at this stage (pre-commit)");
    expect(out).not.toContain("Project ground rules");
  });

  it("does not substitute markers inside a triple-backtick code fence", async () => {
    await run(
      createDirective({
        projectId,
        scope: "post-auditor-pass",
        category: "dev",
        kind: "rule",
        title: "Should not appear",
        instruction: "irrelevant",
      }),
    );
    const tpl =
      "before\n" +
      "```\n" +
      "{{hooks scope=post-auditor-pass category=dev}}\n" +
      "```\n" +
      "after\n";
    const out = await run(renderTemplate(tpl, projectId));
    expect(out).toContain("{{hooks scope=post-auditor-pass category=dev}}");
    expect(out).not.toContain("Should not appear");
    expect(out).not.toContain("Project hooks at this stage");
  });

  it("does not substitute markers inside a fenced block with a language tag", async () => {
    await run(
      createDirective({
        projectId,
        scope: "post-auditor-pass",
        category: "dev",
        kind: "rule",
        title: "Should not appear",
        instruction: "irrelevant",
      }),
    );
    const tpl =
      "before\n" +
      "```markdown\n" +
      "{{hooks scope=post-auditor-pass category=dev}}\n" +
      "```\n" +
      "after\n";
    const out = await run(renderTemplate(tpl, projectId));
    expect(out).toContain("{{hooks scope=post-auditor-pass category=dev}}");
    expect(out).not.toContain("Project hooks at this stage");
  });

  it("leaves a malformed marker (missing category) untouched", async () => {
    const tpl = "before\n{{hooks scope=post-auditor-pass}}\nafter\n";
    const out = await run(renderTemplate(tpl, projectId));
    expect(out).toBe(tpl);
  });

  it("leaves a marker with attributes in reverse order untouched", async () => {
    const tpl = "before\n{{hooks category=dev scope=post-auditor-pass}}\nafter\n";
    const out = await run(renderTemplate(tpl, projectId));
    expect(out).toBe(tpl);
  });

  it("leaves a marker with extra inner whitespace untouched", async () => {
    const tpl = "before\n{{ hooks scope=post-auditor-pass category=dev }}\nafter\n";
    const out = await run(renderTemplate(tpl, projectId));
    expect(out).toBe(tpl);
  });

  it("omits directives where enabled = false", async () => {
    const visible = await run(
      createDirective({
        projectId,
        scope: "post-auditor-pass",
        category: "dev",
        kind: "rule",
        title: "Visible",
        instruction: "Stay visible.",
      }),
    );
    const hidden = await run(
      createDirective({
        projectId,
        scope: "post-auditor-pass",
        category: "dev",
        kind: "rule",
        title: "Hidden",
        instruction: "Should be filtered out.",
      }),
    );
    await run(updateDirective(hidden.id, { enabled: false }));
    const tpl = "{{hooks scope=post-auditor-pass category=dev}}";
    const out = await run(renderTemplate(tpl, projectId));
    expect(out).toContain("Visible");
    expect(out).not.toContain("Hidden");
    expect(out).not.toContain("Should be filtered out");
    // The single remaining directive is item 1, not item 2.
    expect(out).toContain("1. **Visible**");
    expect(out).toContain(visible.id.slice(0, 0)); // touch `visible` to keep lint happy
  });

  it("filters by both scope and category — directives from another category are ignored", async () => {
    await run(
      createDirective({
        projectId,
        scope: "always",
        category: "dev",
        kind: "rule",
        title: "Dev rule",
        instruction: "dev only",
      }),
    );
    await run(
      createDirective({
        projectId,
        scope: "always",
        category: "coder",
        kind: "rule",
        title: "Coder rule",
        instruction: "coder only",
      }),
    );
    const tpl = "{{directives scope=always category=coder}}";
    const out = await run(renderTemplate(tpl, projectId));
    expect(out).toContain("Coder rule");
    expect(out).not.toContain("Dev rule");
  });

  it("substitutes multiple markers in the same template independently", async () => {
    await run(
      createDirective({
        projectId,
        scope: "always",
        category: "dev",
        kind: "rule",
        title: "Always rule",
        instruction: "always",
      }),
    );
    const tpl =
      "{{directives scope=always category=dev}}\n\n" +
      "---\n\n" +
      "{{hooks scope=post-auditor-pass category=dev}}\n";
    const out = await run(renderTemplate(tpl, projectId));
    expect(out).toContain("### Project ground rules (always)");
    expect(out).toContain("Always rule");
    expect(out).toContain("_No project hooks at this stage._");
  });

  it("omits the `(in <repoTarget>)` suffix when repoTarget is `auto`", async () => {
    await run(
      createDirective({
        projectId,
        scope: "post-auditor-pass",
        category: "dev",
        kind: "command",
        title: "Default target",
        instruction: "echo hi",
        // repoTarget defaults to "auto"
      }),
    );
    const tpl = "{{hooks scope=post-auditor-pass category=dev}}";
    const out = await run(renderTemplate(tpl, projectId));
    expect(out).toContain("Run: `echo hi`");
    expect(out).not.toContain("(in auto)");
  });
});

// ── PRD 0025: {{prototype_state}} marker ─────────────────────────────────────

import { createPrd } from "#/modules/prds/domain";
import {
  addFeedback,
  addPage,
  addVariant,
  addVersion,
  createPrototype,
  ignoreFeedback,
  resolveFeedback,
} from "#/modules/prds/prototypes";

describe("renderTemplate {{prototype_state}} marker (PRD 0025 / T1)", () => {
  let db: Database;
  let run: ReturnType<typeof makeRun>;
  let projectId: string;
  let prdRevisionId: string;

  beforeEach(async () => {
    db = createTestDb().db;
    run = makeRun(db);
    projectId = (await run(createProject({ name: "p" }))).id;
    prdRevisionId = (await run(createPrd({ projectId, title: "X" }))).id;
  });

  it("renders an inline error when prototypeId is missing", async () => {
    const tpl = "before\n{{prototype_state}}\nafter";
    const out = await run(renderTemplate(tpl, projectId));
    expect(out).toContain("requires prototypeId=<id>");
    expect(out).toContain("before");
    expect(out).toContain("after");
  });

  it("renders a single-line empty-prototype block when no pages exist", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "jobs-rework" }));
    const tpl = `{{prototype_state prototypeId=${proto.id}}}`;
    const out = await run(renderTemplate(tpl, projectId));
    expect(out).toContain("Prototype: jobs-rework (slug)");
    expect(out).toContain("_No pages yet._");
  });

  it("renders the structured tree (page → versions → variants) with derived buckets", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "jobs-rework" }));
    const page = await run(addPage({ prototypeId: proto.id, slug: "jobs-list", title: "Jobs" }));
    const v1 = await run(addVersion({ pageId: page.id, label: "v1" }));
    const v1Rail = await run(
      addVariant({
        pageVersionId: v1.id,
        label: "rail",
        title: "Rail",
        htmlContent: "<p/>",
      }),
    );
    const v1Tabs = await run(
      addVariant({
        pageVersionId: v1.id,
        label: "tabs",
        title: "Tabs",
        htmlContent: "<p/>",
      }),
    );
    const fb1 = await run(
      addFeedback({
        variantId: v1Tabs.id,
        text: "Le CTA principal devrait être plus saillant",
        selectorCss: ".header-cta",
      }),
    );
    const fb2 = await run(addFeedback({ variantId: v1Tabs.id, text: "Manque le breadcrumb" }));

    // Mint v2; the v1 feedbacks become derived "resolved".
    const v2 = await run(addVersion({ pageId: page.id, label: "v2" }));
    const v2Refined = await run(
      addVariant({
        pageVersionId: v2.id,
        label: "rail-refined",
        title: "Rail refined",
        htmlContent: "<p/>",
      }),
    );
    await run(resolveFeedback(fb1.id, { note: "Moved CTA to header", viaVariantId: v2Refined.id }));
    await run(ignoreFeedback(fb2.id, { reason: "Out of scope for this iteration" }));

    const tpl = `{{prototype_state prototypeId=${proto.id}}}`;
    const out = await run(renderTemplate(tpl, projectId));

    expect(out).toContain("Prototype: jobs-rework (slug)");
    expect(out).toContain("Page: jobs-list (2 versions)");
    expect(out).toContain("Version v2 (latest");
    expect(out).toContain("rail-refined");
    expect(out).toContain("Open feedbacks (still actionable): 0");

    expect(out).toContain("Resolved feedbacks (open on v1, derived as addressed)");
    expect(out).toContain('"Le CTA principal devrait être plus saillant"');
    expect(out).toContain("Moved CTA to header");

    expect(out).toContain("Ignored feedbacks");
    expect(out).toContain("Out of scope for this iteration");
    void v1Rail;
  });

  it("emits a marker error when the prototype id does not exist", async () => {
    const tpl = "{{prototype_state prototypeId=01XINVALID}}";
    const out = await run(renderTemplate(tpl, projectId));
    expect(out).toContain("prototype 01XINVALID not found");
  });
});

// ── PRD 0027: {{idea_state}} marker ──────────────────────────────────────────

import { createIdea, dropIdea } from "#/modules/ideas/domain";

describe("renderTemplate {{idea_state}} marker (PRD 0027 / T5)", () => {
  let db: Database;
  let run: ReturnType<typeof makeRun>;
  let projectId: string;

  beforeEach(async () => {
    db = createTestDb().db;
    run = makeRun(db);
    projectId = (await run(createProject({ name: "p" }))).id;
  });

  it("renders the empty placeholder when no open ideas exist", async () => {
    const tpl = "before\n{{idea_state}}\nafter";
    const out = await run(renderTemplate(tpl, projectId));
    expect(out).toContain("before");
    expect(out).toContain("_No open ideas._");
    expect(out).toContain("after");
    expect(out).not.toMatch(/\{\{idea_state\}\}/);
  });

  it("lists open ideas newest-first as `<id>  <title>  [tag]`", async () => {
    const first = await run(createIdea({ projectId, title: "Older idea", tag: "plugins" }));
    const second = await run(createIdea({ projectId, title: "Newer idea" }));
    const tpl = "{{idea_state}}";
    const out = await run(renderTemplate(tpl, projectId));
    expect(out).toContain(`${second.id}  Newer idea`);
    expect(out).toContain(`${first.id}  Older idea  [plugins]`);
    // newest-first ordering: the newer idea's line comes before the older one's.
    expect(out.indexOf(second.id)).toBeLessThan(out.indexOf(first.id));
    expect(out).not.toMatch(/\{\{idea_state\}\}/);
  });

  it("excludes non-open ideas (dropped) from the list", async () => {
    const open = await run(createIdea({ projectId, title: "Still open" }));
    const dropped = await run(createIdea({ projectId, title: "Gone idea" }));
    await run(dropIdea(dropped.id));
    const out = await run(renderTemplate("{{idea_state}}", projectId));
    expect(out).toContain("Still open");
    expect(out).not.toContain("Gone idea");
    void open;
  });
});

// ── PRD 0030 / issue 05: {{task_placement}} marker ──────────────────────────

import { createTask } from "#/modules/tasks/domain";
import { linkTaskPage } from "#/modules/prds/task-pages";
import {
  createRound,
  distillPagePlacement,
  dropPage,
  getCurrentRound,
} from "#/modules/prds/prototypes";

describe("renderTemplate {{task_placement}} marker (PRD 0030 / 05)", () => {
  let db: Database;
  let run: ReturnType<typeof makeRun>;
  let projectId: string;
  let prdRevisionId: string;

  const REGIONS_SPEC = [
    "## Regions",
    "- Header band, then a two-column body.",
    "## Order",
    "1. Logo, 2. Nav, 3. CTA.",
    "## Hierarchy",
    "The CTA dominates.",
    "## States",
    "empty, loading, ready.",
  ].join("\n");

  const makeTask = (title: string) =>
    run(
      createTask({
        prdRevisionId,
        title,
        description: "Intent: …",
        doneCriteria: "Works",
        effort: "s",
      }),
    );

  // A page with one version + one variant, auto-included in the prototype's
  // current round (the first version auto-includes the page) and ready to be
  // distilled.
  const makePage = async (protoSlug: string, pageSlug: string) => {
    const proto = await run(createPrototype({ prdRevisionId, slug: protoSlug }));
    const page = await run(addPage({ prototypeId: proto.id, slug: pageSlug, title: pageSlug }));
    const version = await run(addVersion({ pageId: page.id, label: "v1" }));
    await run(
      addVariant({
        pageVersionId: version.id,
        label: "a",
        title: "A",
        htmlContent: "<p/>",
      }),
    );
    return { proto, page };
  };

  beforeEach(async () => {
    db = createTestDb().db;
    run = makeRun(db);
    projectId = (await run(createProject({ name: "p" }))).id;
    prdRevisionId = (await run(createPrd({ projectId, title: "X" }))).id;
  });

  it("renders an inline error when taskId is missing", async () => {
    const tpl = "before\n{{task_placement}}\nafter";
    const out = await run(renderTemplate(tpl, projectId));
    expect(out).toContain("requires taskId=<id>");
    expect(out).toContain("before");
    expect(out).toContain("after");
  });

  it("renders a neutral placeholder when the task has no linked pages", async () => {
    const task = await makeTask("T");
    const tpl = `{{task_placement taskId=${task.id}}}`;
    const out = await run(renderTemplate(tpl, projectId));
    expect(out).toContain("_No prototype pages linked to this task._");
    expect(out).not.toMatch(/\{\{task_placement/);
  });

  it("renders only the task's linked page + its current-round placement", async () => {
    const { proto, page } = await makePage("proto", "home");
    const other = await makePage("proto-2", "other"); // a second page, NOT linked

    const round = (await run(getCurrentRound(proto.id)))!;
    await run(distillPagePlacement(round.id, page.id, { placementSpec: REGIONS_SPEC }));
    const otherRound = (await run(getCurrentRound(other.proto.id)))!;
    await run(
      distillPagePlacement(otherRound.id, other.page.id, {
        placementSpec: REGIONS_SPEC.replace("two-column body", "OTHER-PAGE body"),
      }),
    );

    const task = await makeTask("T");
    await run(linkTaskPage(task.id, page.id));

    const tpl = `{{task_placement taskId=${task.id}}}`;
    const out = await run(renderTemplate(tpl, projectId));

    // The linked page and its placement are rendered…
    expect(out).toContain("home");
    expect(out).toContain("two-column body");
    expect(out).toContain("## Regions");
    expect(out).toContain("## Order");
    // …and nothing from the unrelated page leaks in.
    expect(out).not.toContain("other");
    expect(out).not.toContain("OTHER-PAGE body");
  });

  it("renders several linked pages, each with its own placement", async () => {
    const { proto, page: home } = await makePage("proto", "home");
    // Second page in the same prototype (same current round).
    const list = await run(addPage({ prototypeId: proto.id, slug: "list", title: "list" }));
    const listV = await run(addVersion({ pageId: list.id, label: "v1" }));
    await run(addVariant({ pageVersionId: listV.id, label: "a", title: "A", htmlContent: "<p/>" }));

    const round = (await run(getCurrentRound(proto.id)))!;
    await run(distillPagePlacement(round.id, home.id, { placementSpec: REGIONS_SPEC }));
    await run(
      distillPagePlacement(round.id, list.id, {
        placementSpec: REGIONS_SPEC.replace("two-column body", "LIST body"),
      }),
    );

    const task = await makeTask("T");
    await run(linkTaskPage(task.id, home.id));
    await run(linkTaskPage(task.id, list.id));

    const out = await run(renderTemplate(`{{task_placement taskId=${task.id}}}`, projectId));
    expect(out).toContain("home");
    expect(out).toContain("two-column body");
    expect(out).toContain("list");
    expect(out).toContain("LIST body");
  });

  it("notes 'not distilled yet' for a linked page without a current-round placement", async () => {
    const { page } = await makePage("proto", "home");
    const task = await makeTask("T");
    await run(linkTaskPage(task.id, page.id));

    const out = await run(renderTemplate(`{{task_placement taskId=${task.id}}}`, projectId));
    expect(out).toContain("home");
    expect(out).toContain("not distilled yet");
    // No crash, no leftover marker.
    expect(out).not.toMatch(/\{\{task_placement/);
  });

  it("does not render stale placement after the linked page is dropped from the current round", async () => {
    const { proto, page } = await makePage("proto", "home");
    const round = (await run(getCurrentRound(proto.id)))!;
    await run(distillPagePlacement(round.id, page.id, { placementSpec: REGIONS_SPEC }));
    await run(dropPage(round.id, page.id));

    const task = await makeTask("T");
    await run(linkTaskPage(task.id, page.id));

    const out = await run(renderTemplate(`{{task_placement taskId=${task.id}}}`, projectId));
    expect(out).toContain("home");
    expect(out).toContain("not distilled yet");
    expect(out).not.toContain("two-column body");
  });

  it("renders the CURRENT round's placement, not an earlier round's", async () => {
    const { proto, page } = await makePage("proto", "home");

    const round1 = (await run(getCurrentRound(proto.id)))!;
    await run(
      distillPagePlacement(round1.id, page.id, {
        placementSpec: REGIONS_SPEC.replace("two-column body", "ROUND-ONE body"),
      }),
    );

    // Open a new round cloned from round1 (inherits the placement), then
    // re-distill the page in the new round with a different placement.
    const round2 = await run(
      createRound({ prototypeId: proto.id, label: "v2", fromRoundId: round1.id }),
    );
    await run(
      distillPagePlacement(round2.id, page.id, {
        placementSpec: REGIONS_SPEC.replace("two-column body", "ROUND-TWO body"),
      }),
    );

    const task = await makeTask("T");
    await run(linkTaskPage(task.id, page.id));

    const out = await run(renderTemplate(`{{task_placement taskId=${task.id}}}`, projectId));
    expect(out).toContain("ROUND-TWO body");
    expect(out).not.toContain("ROUND-ONE body");
  });
});
