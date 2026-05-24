// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import { LiveActivityPanel } from "#/web/components/live-activity-panel";
import type { PrdDetailResponse } from "#/web/lib/api-types";

type DetailActivity = PrdDetailResponse["activity"][number];
type DetailTask = PrdDetailResponse["tasks"][number];

function progressEvent(
  id: string,
  payload: Record<string, unknown>,
  createdAt = "2026-05-18T09:00:00.000Z",
): DetailActivity {
  return {
    id,
    eventType: "coder_progress",
    payload,
    taskId: null,
    source: "ai",
    createdAt,
  } as DetailActivity;
}

describe("LiveActivityPanel", () => {
  it("renders nothing when the PRD is not in progress", () => {
    const { container } = render(<LiveActivityPanel prdStatus="done" activity={[]} tasks={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the waiting message with no events", () => {
    render(<LiveActivityPanel prdStatus="in_progress" activity={[]} tasks={[]} />);
    expect(screen.getByText(/waiting for the coder/i)).toBeInTheDocument();
  });

  it("renders coder progress through the shared timeline with expandable output", () => {
    const activity: DetailActivity[] = [
      progressEvent("e1", {
        stage: "tool",
        message: "Ran the suite",
        command: "bun run test",
        output: "455 passed",
      }),
    ];
    render(
      <LiveActivityPanel prdStatus="in_progress" activity={activity} tasks={[] as DetailTask[]} />,
    );

    expect(screen.getByText("Ran the suite")).toBeInTheDocument();
    expect(screen.getByText("tool")).toBeInTheDocument();

    expect(screen.queryByText("455 passed")).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /show output/i }));
    expect(screen.getByText("455 passed")).toBeVisible();
  });

  it("invokes onFileClick for file links", () => {
    const onFileClick = vi.fn<(file: string) => void>();
    const activity: DetailActivity[] = [
      progressEvent("e1", { stage: "edit", message: "Edited", file: "src/app.ts" }),
    ];
    render(
      <LiveActivityPanel
        prdStatus="in_progress"
        activity={activity}
        tasks={[] as DetailTask[]}
        onFileClick={onFileClick}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "src/app.ts" }));
    expect(onFileClick).toHaveBeenCalledWith("src/app.ts");
  });
});
