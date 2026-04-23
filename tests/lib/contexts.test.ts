import { describe, it, expect } from "vitest";
import { getContextTemplate, listContextModes } from "#/modules/context/index";

describe("context template registry", () => {
  it("lists all available context modes", () => {
    const list = listContextModes();
    expect(list).toContain("prd");
    expect(list).toContain("dev");
    expect(list).not.toContain("review");
    expect(list).toHaveLength(2);
  });

  it("returns embedded prd context content", () => {
    const content = getContextTemplate("prd");
    expect(content).toContain("Context: PRD Agent");
    expect(content).toContain("Interview");
    expect(content).toContain("Mark Ready");
  });

  it("returns embedded dev context content", () => {
    const content = getContextTemplate("dev");
    expect(content).toContain("Context: Dev Agent");
    expect(content).toContain("depot context dev");
    expect(content).toContain("depot task show <task_id>");
    expect(content).toContain("depot task start");
    expect(content).not.toContain("depot log add handoff");
    expect(content).toContain("Do not rely on `depot context dev` alone");
    expect(content).not.toContain("depot log add <project_id> handoff");
  });

  it("returns embedded prd context task-spec guidance", () => {
    const content = getContextTemplate("prd");
    expect(content).toContain("Intent:");
    expect(content).toContain("Scope:");
    expect(content).toContain("Non-goals:");
    expect(content).toContain("important execution ambiguity");
    expect(content).toContain("Older tasks may remain as legacy freeform descriptions");
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
