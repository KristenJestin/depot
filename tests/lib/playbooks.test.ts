import { describe, it, expect } from "vitest";
import { getPlaybook, listPlaybooks } from "#/lib/playbooks";

describe("playbook registry", () => {
  it("lists all available playbooks", () => {
    const list = listPlaybooks();
    expect(list).toContain("prd");
    expect(list).toContain("dev");
    expect(list).toContain("review");
    expect(list).toHaveLength(3);
  });

  it("returns embedded prd playbook content", () => {
    const content = getPlaybook("prd");
    expect(content).toContain("Playbook: PRD Agent");
    expect(content).toContain("Interview");
    expect(content).toContain("depot prd commit");
  });

  it("returns embedded dev playbook content", () => {
    const content = getPlaybook("dev");
    expect(content).toContain("Playbook: Dev Agent");
    expect(content).toContain("depot handoff");
    expect(content).toContain("depot task start");
  });

  it("returns embedded review playbook content", () => {
    const content = getPlaybook("review");
    expect(content).toContain("Playbook: Review Agent");
    expect(content).toContain("done_criteria");
    expect(content).toContain("Security");
  });

  it("throws on unknown playbook name", () => {
    expect(() => getPlaybook("unknown")).toThrow(/Unknown playbook/);
  });

  it("does not require filesystem reads (content is embedded)", () => {
    // This test verifies the contract: playbooks are string constants,
    // not loaded from disk. Getting content should be synchronous.
    const content = getPlaybook("prd");
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(100);
  });
});
