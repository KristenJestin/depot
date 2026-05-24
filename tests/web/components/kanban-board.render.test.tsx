// @vitest-environment happy-dom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import { KanbanBoard } from "#/web/components/kanban-board";
import type { BoardColumn } from "#/web/lib/prd-view-model";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    className,
    to: _to,
    params: _params,
    search: _search,
    activeOptions: _activeOptions,
    ...props
  }: {
    children?: React.ReactNode;
    className?: string;
    to?: unknown;
    params?: unknown;
    search?: unknown;
    activeOptions?: unknown;
  } & React.ComponentPropsWithoutRef<"a">) => (
    <a href="#" className={className} {...props}>
      {children}
    </a>
  ),
}));

describe("KanbanBoard", () => {
  it("collapses task previews by default on active cards and toggles them open on click", () => {
    const columns: BoardColumn[] = [
      {
        id: "ready",
        title: "Todo",
        cards: [
          {
            id: "ready-card",
            prdId: "prd-1",
            projectId: "proj-1",
            projectName: "Acme",
            title: "Ready card",
            context: null,
            status: "ready",
            updatedAt: "2026-04-30T10:00:00.000Z",
            totalTasks: 1,
            doneTasks: 0,
            blockedTasks: 0,
            inProgressTasks: 0,
            skippedTasks: 0,
            latestReview: null,
            previewTasks: [{ id: "ready-task", title: "Ready preview", status: "pending" }],
            footerLabel: "ready",
            animatedLabel: null,
          },
        ],
      },
    ];

    render(<KanbanBoard columns={columns} />);

    const readySection = screen.getByRole("heading", { name: "Todo" }).closest("section");
    expect(readySection).not.toBeNull();

    expect(within(readySection as HTMLElement).queryByText("Ready preview")).not.toBeVisible();
    expect(within(readySection as HTMLElement).queryByText("Ready")).not.toBeInTheDocument();

    const readyToggle = within(readySection as HTMLElement).getByRole("button", { name: "Tasks" });
    fireEvent.click(readyToggle);

    expect(readyToggle).toHaveAttribute("aria-expanded", "true");
    expect(within(readySection as HTMLElement).getByText("Ready preview")).toBeVisible();
  });

  it("hides the Tasks toggle on terminal cards (done / canceled)", () => {
    const columns: BoardColumn[] = [
      {
        id: "done",
        title: "Done",
        cards: [
          {
            id: "done-card",
            prdId: "prd-2",
            projectId: "proj-1",
            projectName: "Acme",
            title: "Done card",
            context: null,
            status: "done",
            updatedAt: "2026-04-30T10:00:00.000Z",
            totalTasks: 1,
            doneTasks: 1,
            blockedTasks: 0,
            inProgressTasks: 0,
            skippedTasks: 0,
            latestReview: null,
            previewTasks: [{ id: "done-task", title: "Done preview", status: "done" }],
            footerLabel: "done",
            animatedLabel: null,
          },
        ],
      },
    ];

    render(<KanbanBoard columns={columns} />);

    const doneSection = screen.getByRole("heading", { name: "Done" }).closest("section");
    expect(doneSection).not.toBeNull();

    // Tasks panel is suppressed entirely on terminal cards; they are not actionable.
    expect(
      within(doneSection as HTMLElement).queryByRole("button", { name: "Tasks" }),
    ).not.toBeInTheDocument();
  });

  it("shows a homogenized empty state when there are no PRDs", () => {
    render(<KanbanBoard columns={[{ id: "ready", title: "Todo", cards: [] }]} />);

    const empty = document.querySelector('[data-slot="empty-state"]');
    expect(empty).not.toBeNull();
    expect(empty).toHaveTextContent(/no prds yet/i);
    expect(empty).toHaveTextContent("depot prd create");
  });

  it("does not repeat done status or render the footer timestamp for done cards", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-30T10:01:00.000Z"));

    const columns: BoardColumn[] = [
      {
        id: "done",
        title: "Done",
        cards: [
          {
            id: "done-card",
            prdId: "prd-2",
            projectId: "proj-1",
            projectName: "Acme",
            title: "Done card",
            context: null,
            status: "done",
            updatedAt: "2026-04-30T10:00:00.000Z",
            totalTasks: 1,
            doneTasks: 1,
            blockedTasks: 0,
            inProgressTasks: 0,
            skippedTasks: 0,
            latestReview: null,
            previewTasks: [],
            footerLabel: "Completed",
            animatedLabel: null,
          },
        ],
      },
    ];

    render(<KanbanBoard columns={columns} />);

    const doneSection = screen.getByRole("heading", { name: "Done" }).closest("section");

    expect(doneSection).not.toBeNull();
    expect(within(doneSection as HTMLElement).queryByText("Completed")).not.toBeInTheDocument();
    expect(within(doneSection as HTMLElement).queryByText("1m ago")).not.toBeInTheDocument();

    vi.useRealTimers();
  });
});
