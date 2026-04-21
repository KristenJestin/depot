import { describe, it, expect } from "vitest";
import { getContextTemplate, listContextModes } from "#/lib/contexts";

describe("context template registry", () => {
  it("lists all available context modes", () => {
    const list = listContextModes();
    expect(list).toContain("prd");
    expect(list).toContain("dev");
    expect(list).toContain("review");
    expect(list).toHaveLength(3);
  });

  it("returns embedded prd context content", () => {
    const content = getContextTemplate("prd");
    expect(content).toContain("Context: PRD Agent");
    expect(content).toContain("Interview");
    expect(content).toContain("depot prd commit");
  });

  it("returns embedded dev context content", () => {
    const content = getContextTemplate("dev");
    expect(content).toContain("Context: Dev Agent");
    expect(content).toContain("depot handoff");
    expect(content).toContain("depot task start");
    expect(content).toContain("depot log add handoff");
    expect(content).not.toContain("depot log add <project_id> handoff");
  });

  it("returns embedded review context content", () => {
    const content = getContextTemplate("review");
    expect(content).toContain("Context: Review Agent");
    expect(content).toContain("done_criteria");
    expect(content).toContain("Security");
    expect(content).toContain("depot context review");
    expect(content).not.toContain("--status done");
    expect(content).toContain("depot log add note");
    expect(content).not.toContain("block the task");
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
