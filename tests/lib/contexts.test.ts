import { describe, it, expect } from "vitest";
import { getContextTemplate, listContextModes } from "#/modules/context/index";

describe("context template registry", () => {
  it("lists all available context modes", () => {
    const list = listContextModes();
    expect(list).toContain("prd");
    expect(list).toContain("dev");
    expect(list).toContain("coder");
    expect(list).toContain("auditor");
    expect(list).not.toContain("review");
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
    expect(content).toContain("--repo <name1>=<sha1>");
    expect(content).toContain("do **not** mark the PRD done");
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
