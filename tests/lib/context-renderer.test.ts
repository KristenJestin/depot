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
