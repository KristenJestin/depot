import { describe, expect, it } from "vitest";
import {
  detectTaskDescriptionFormat,
  formatStructuredTaskDescription,
  getTaskDescriptionSections,
  normalizeTaskDescriptionForStorage,
  summarizeTaskDescription,
} from "#/lib/task-spec";

describe("task spec helpers", () => {
  it("formats the structured task description shape", () => {
    expect(
      formatStructuredTaskDescription({
        intent: "Clarify the task intent for execution.",
        scope: ["Render structured specs in task show", "Keep old descriptions readable"],
        nonGoals: "Do not require legacy task rewrites",
      }),
    ).toBe(
      [
        "Intent:",
        "Clarify the task intent for execution.",
        "",
        "Scope:",
        "- Render structured specs in task show",
        "- Keep old descriptions readable",
        "",
        "Non-goals:",
        "- Do not require legacy task rewrites",
      ].join("\n"),
    );
  });

  it("parses structured task descriptions into labeled sections", () => {
    expect(
      getTaskDescriptionSections([
        "Intent:",
        "Clarify the task intent for execution.",
        "",
        "Scope:",
        "- Render structured specs in task show",
        "- Keep old descriptions readable",
        "",
        "Non_goals:",
        "- Do not require legacy task rewrites",
      ].join("\n")),
    ).toEqual([
      {
        label: "Intent",
        style: "text",
        lines: ["Clarify the task intent for execution."],
      },
      {
        label: "Scope",
        style: "list",
        lines: ["Render structured specs in task show", "Keep old descriptions readable"],
      },
      {
        label: "Non-goals",
        style: "list",
        lines: ["Do not require legacy task rewrites"],
      },
    ]);
  });

  it("detects and normalizes structured task descriptions for storage", () => {
    expect(
      normalizeTaskDescriptionForStorage([
        "Intent:",
        "Clarify the task intent for execution.",
        "",
        "Scope:",
        "Render structured specs in task show",
        "Keep old descriptions readable",
        "",
        "Non-goals:",
        "Do not require legacy task rewrites",
      ].join("\n")),
    ).toEqual({
      description: formatStructuredTaskDescription({
        intent: "Clarify the task intent for execution.",
        scope: ["Render structured specs in task show", "Keep old descriptions readable"],
        nonGoals: "Do not require legacy task rewrites",
      }),
      descriptionFormat: "structured_v1",
    });

    expect(detectTaskDescriptionFormat("Legacy freeform description")).toBe("legacy");
  });

  it("rejects incomplete structured task descriptions", () => {
    expect(() =>
      normalizeTaskDescriptionForStorage([
        "Intent:",
        "Clarify the task intent for execution.",
        "",
        "Scope:",
        "- Render structured specs in task show",
      ].join("\n")),
    ).toThrow(/Intent, Scope, and Non-goals/);
  });

  it("keeps legacy task descriptions readable", () => {
    expect(getTaskDescriptionSections("Summarize active workspace state")).toEqual([
      {
        label: "Description",
        style: "text",
        lines: ["Summarize active workspace state"],
      },
    ]);
  });

  it("summarizes structured descriptions from intent instead of the heading", () => {
    expect(
      summarizeTaskDescription([
        "Intent:",
        "Implement the current execution path.",
        "",
        "Scope:",
        "- Touch the dev context summary",
        "",
        "Non-goals:",
        "- Do not retrofit older tasks.",
      ].join("\n")),
    ).toBe("Implement the current execution path.");
  });
});
