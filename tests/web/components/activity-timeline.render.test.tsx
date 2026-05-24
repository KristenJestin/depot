// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import { ActivityTimeline, type TimelineEntry } from "#/web/components/activity-timeline";

/**
 * The shared coss-ui activity timeline: day grouping, source badges, clickable
 * file links, and expandable bash output.
 */
describe("ActivityTimeline", () => {
  it("renders the empty message when there are no entries", () => {
    render(<ActivityTimeline entries={[]} emptyMessage="Nothing logged" />);
    expect(screen.getByText("Nothing logged")).toBeInTheDocument();
  });

  it("groups entries under day headers", () => {
    const entries: TimelineEntry[] = [
      { id: "a", createdAt: "2026-05-18T09:00:00.000Z", label: "First" },
      { id: "b", createdAt: "2026-05-18T11:00:00.000Z", label: "Second" },
      { id: "c", createdAt: "2026-05-19T08:00:00.000Z", label: "Third" },
    ];
    render(<ActivityTimeline entries={entries} />);

    const headers = [...document.querySelectorAll("p.uppercase.tracking-widest")];
    expect(headers).toHaveLength(2);
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Third")).toBeInTheDocument();
  });

  it("renders source badges", () => {
    const entries: TimelineEntry[] = [
      { id: "a", createdAt: "2026-05-18T09:00:00.000Z", label: "Human edit", source: "human" },
      { id: "b", createdAt: "2026-05-18T10:00:00.000Z", label: "Plugin run", source: "plugin" },
    ];
    render(<ActivityTimeline entries={entries} />);
    expect(screen.getByText("human")).toBeInTheDocument();
    expect(screen.getByText("plugin")).toBeInTheDocument();
  });

  it("makes file paths clickable when onFileClick is supplied", () => {
    const onFileClick = vi.fn<(file: string) => void>();
    const entries: TimelineEntry[] = [
      {
        id: "a",
        createdAt: "2026-05-18T09:00:00.000Z",
        label: "Edited a file",
        file: "src/index.ts",
      },
    ];
    render(<ActivityTimeline entries={entries} onFileClick={onFileClick} />);

    fireEvent.click(screen.getByRole("button", { name: "src/index.ts" }));
    expect(onFileClick).toHaveBeenCalledWith("src/index.ts");
  });

  it("expands bash output on demand", () => {
    const entries: TimelineEntry[] = [
      {
        id: "a",
        createdAt: "2026-05-18T09:00:00.000Z",
        label: "Ran tests",
        command: "bun run test",
        output: "456 passed",
      },
    ];
    render(<ActivityTimeline entries={entries} />);

    expect(screen.queryByText("456 passed")).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /show output/i }));
    expect(screen.getByText("456 passed")).toBeVisible();
  });
});
