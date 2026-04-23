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
    expect(content).toContain("Interview");
    expect(content).toContain("Mark Ready");
  });

  it("returns embedded dev context content", () => {
    const content = getContextTemplate("dev");
    expect(content).toContain("Context: Dev Orchestrator");
    expect(content).toContain("depot context dev");
    expect(content).toContain("depot context coder");
    expect(content).toContain("depot context auditor");
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
