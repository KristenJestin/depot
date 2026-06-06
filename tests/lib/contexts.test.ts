import { describe, it, expect } from "vite-plus/test";
import { getContextTemplate, listContextModes } from "#/modules/context/index";

describe("context template registry", () => {
  it("lists all available context modes", () => {
    const list = listContextModes();
    expect(list).toContain("prd");
    expect(list).toContain("dev");
    expect(list).toContain("coder");
    expect(list).toContain("auditor");
    expect(list).toContain("prototype");
    expect(list).not.toContain("review");
  });

  it("returns embedded prototype context content (PRD 0025 / T1)", () => {
    const content = getContextTemplate("prototype");
    expect(content).toContain("Context: Prototype Sub-Agent");
    expect(content).toContain("Inter-page links");
    expect(content).toContain("data-depot-page");
    expect(content).toContain("self-contained");
    expect(content).toContain("Versions are frozen");
    expect(content).toContain("--reason");
    expect(content).toContain("{{prototype_state prototypeId=<id>}}");
    expect(content).toContain("{{directives scope=always category=prototype}}");
  });

  it("documents that a single-variant page is retained by default (PRD 0028 — mono-variant)", () => {
    const content = getContextTemplate("prototype");
    expect(content).toContain("A page with a single variant is retained by default.");
    expect(content).toContain("≥ 2 variants");
  });

  it("documents the round model and version/round vocabulary (PRD 0029 / E)", () => {
    const content = getContextTemplate("prototype");
    expect(content).toContain("Rounds — rounds of the whole design");
    expect(content).toContain("manifest");
    expect(content).toContain("current round");
    // The vocabulary correction: "v1/v2" name rounds, not page versions.
    expect(content).toContain('Stop using "v1/v2"');
    // A dropped page link is a "dropped" outcome, not an error.
    expect(content).toContain("removed in this round");
    // The design-lock now scopes to the current round.
    expect(content).toContain("design-lock gate");
    expect(content).toContain("won't ship and the gate stops");
  });

  it("instructs feedback ⇒ a new round, never mutate the current one (PRD 0030 / 03)", () => {
    const content = getContextTemplate("prototype");
    // The protocol headline must appear verbatim so the sub-agent reads it.
    expect(content).toContain("feedback ⇒ a new round, never mutate the current one");
    // A round is a frozen snapshot once it stops being current.
    expect(content).toContain("frozen snapshot");
    // The shortcut to open the next round from the current one.
    expect(content).toContain("--from-current");
    // Unchanged pages carry forward by pointer; the user only sees rounds.
    expect(content).toContain("carried forward by pointer");
    expect(content).toContain("never shows the user a `version`");
  });

  it("returns embedded prd context content", () => {
    const content = getContextTemplate("prd");
    expect(content).toContain("Context: PRD Agent");
    expect(content).toContain("You own PRD authoring only");
    expect(content).toContain("Keep A Draft Alive");
    expect(content).toContain("Finish At Ready");
  });

  it("returns embedded dev context content", () => {
    const content = getContextTemplate("dev");
    expect(content).toContain("Context: Dev Orchestrator");
    expect(content).toContain("depot prd activate");
    expect(content).toContain("depot context coder");
    expect(content).toContain("depot context auditor");
    expect(content).toContain("depot task block <task-id> <reason>");
    expect(content).toContain("web UI");
  });

  it("returns embedded coder context live-status guidance", () => {
    const content = getContextTemplate("coder");
    expect(content).toContain("Context: Coder Agent");
    expect(content).toContain("depot review show <review-id> --json");
    expect(content).toContain("depot task start <task_id>");
    expect(content).toContain("depot task block <task-id> <reason>");
    expect(content).toContain("The web UI and the dev flow use stored task transitions");
  });

  it("returns embedded prd context task-spec guidance", () => {
    const content = getContextTemplate("prd");
    expect(content).toContain("Intent:");
    expect(content).toContain("Scope:");
    expect(content).toContain("Non-goals:");
    expect(content).toContain("do not leave execution ambiguity behind");
    expect(content).toContain("The draft should evolve in real time");
  });

  it("returns a repo-aware ship context", () => {
    const content = getContextTemplate("ship");
    expect(content).toContain("Ship Agent");
    expect(content).toContain("multiple git repos");
    expect(content).toContain("Per-repo state");
    expect(content).toContain("git -C <repoPath> switch <repo.baseBranch>");
    expect(content).toContain("git -C <repoPath> pull --ff-only");
    expect(content).toContain("git -C <repoPath> worktree remove <worktreePath>");
    expect(content).toContain("Depot no longer stores git SHAs or merge anchors");
    expect(content).toContain("do **not** mark the PRD done");
  });

  it("guides the ship agent to pass an explicit doc-sync range post-merge (PRD 0023 / T3)", () => {
    const content = getContextTemplate("ship");
    expect(content).toContain("depot doc sync <profile> --since <squash>^ --until <squash>");
    expect(content).toContain("docSyncTicketPattern");
    expect(content).toContain("never falls back to a magic window");
  });

  it("guides the doc agent to pass an explicit doc-sync range post-merge (PRD 0023 / T3)", () => {
    const content = getContextTemplate("doc");
    expect(content).toContain("depot doc sync <profile> --since <squash>^ --until <squash>");
    expect(content).toContain("docSyncTicketPattern");
    expect(content).toContain("never falls back to a magic window");
  });

  it("separates approval form from scope in the dev STOP encart", () => {
    const content = getContextTemplate("dev");
    expect(content).toContain("is about _form_, not _scope_");
    expect(content).toContain("NOT an approval to transition");
    expect(content).toContain("targets the action");
    // The PRD 0022 "short is valid" clause must remain alongside the scope clause.
    expect(content).toContain("even if very short");
    // The PRD 0012 Branch A "no tacit ok merci" guidance must remain.
    expect(content).toContain('tacit "ok merci"');
  });

  it("separates approval form from scope in the prd STOP encart", () => {
    const content = getContextTemplate("prd");
    expect(content).toContain("is about _form_, not _scope_");
    expect(content).toContain("NOT an approval to transition");
    expect(content).toContain("targets the action");
    expect(content).toContain("even if very short");
  });

  it("guides the prd agent on annex authoring and inline references (PRD 0024 / T3)", () => {
    const content = getContextTemplate("prd");
    expect(content).toContain("loses value when flattened to prose");
    expect(content).toContain(
      'depot prd annex add <prd-id> --name <name> --kind <html|markdown|code|text> --description "<role>" [--file <path> | --content <text>]',
    );
    expect(content).toContain("[annex: <name>]");
    expect(content).toContain("depot prd annex cat <annex-id>");
  });

  it("tells the dev and coder agents to read annexes on demand (PRD 0024 / T3)", () => {
    for (const mode of ["dev", "coder"]) {
      const content = getContextTemplate(mode);
      expect(content).toContain("annexes");
      expect(content).toContain("depot prd annex cat <annex-id>");
      expect(content).toContain("on demand");
      expect(content).toContain("Do not auto-read every annex");
    }
  });

  it("carries the {{task_placement}} marker in the dev and coder contexts (PRD 0030 / 05)", () => {
    for (const mode of ["dev", "coder"]) {
      const content = getContextTemplate(mode);
      expect(content).toContain("{{task_placement taskId=<id>}}");
    }
  });

  it("frames placement vs aesthetics for the implementer (PRD 0030 / 05)", () => {
    for (const mode of ["dev", "coder"]) {
      const content = getContextTemplate(mode);
      // Implement the distilled placement (the validated layout)…
      expect(content).toContain("Implement the distilled **placement**");
      // …while the look comes from the project's design system.
      expect(content).toContain("aesthetics come from the project's design system");
      // The mockup is a layout reference, not pixels to copy.
      expect(content).toContain("layout reference, not pixels to copy");
    }
  });

  it("throws on unknown context mode", () => {
    expect(() => getContextTemplate("unknown")).toThrow(/Unknown context mode/);
  });

  it("does not require filesystem reads (content is embedded)", () => {
    // This test verifies the contract: context templates are string constants,
    // not loaded from disk. Getting content should be synchronous.
    const content = getContextTemplate("prd");
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(100);
  });
});
