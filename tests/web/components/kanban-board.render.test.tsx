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
            priority: "normal",
            previewTasks: [{ id: "ready-task", title: "Ready preview", status: "pending" }],
            footerLabel: "ready",
            animatedLabel: null,
            tags: [],
            targetVersion: null,
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
            priority: "normal",
            previewTasks: [{ id: "done-task", title: "Done preview", status: "done" }],
            footerLabel: "done",
            animatedLabel: null,
            tags: [],
            targetVersion: null,
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

  it("scrolls inside each status column with a sticky header (full-height board layout)", () => {
    const makeCard = (n: number): BoardColumn["cards"][number] => ({
      id: `card-${n}`,
      prdId: `prd-${n}`,
      projectId: "proj-1",
      projectName: "Acme",
      title: `Card ${n}`,
      context: null,
      status: "ready",
      updatedAt: "2026-04-30T10:00:00.000Z",
      totalTasks: 0,
      doneTasks: 0,
      blockedTasks: 0,
      inProgressTasks: 0,
      skippedTasks: 0,
      latestReview: null,
      priority: "normal",
      previewTasks: [],
      footerLabel: "ready",
      animatedLabel: null,
      tags: [],
      targetVersion: null,
    });

    const columns: BoardColumn[] = [
      {
        id: "ready",
        title: "Todo",
        // A column with many cards is the overflow case we want to scroll internally.
        cards: Array.from({ length: 40 }, (_, index) => makeCard(index)),
      },
    ];

    render(<KanbanBoard columns={columns} />);

    const section = screen.getByRole("heading", { name: "Todo" }).closest("section");
    expect(section).not.toBeNull();
    const column = section as HTMLElement;

    // The board root fills its parent's height (no document-level growth) so the
    // overflow lands inside the column rather than scrolling the whole page.
    const boardRoot = column.closest('[class*="flex-1"]');
    expect(boardRoot).not.toBeNull();

    // The column itself is clipped; only its inner list region scrolls.
    expect(column).toHaveAttribute("data-slot", "kanban-column");
    expect(column.className).toContain("h-full");
    expect(column.className).toContain("overflow-hidden");

    // The status header stays pinned while the list scrolls underneath it.
    const header = within(column).getByRole("heading", { name: "Todo" }).closest("header");
    expect(header).not.toBeNull();
    expect((header as HTMLElement).className).toContain("sticky");
    expect((header as HTMLElement).className).toContain("top-0");

    // The scroll happens in the dedicated list container, not globally.
    const scrollRegion = column.querySelector('[data-slot="kanban-column-scroll"]');
    expect(scrollRegion).not.toBeNull();
    expect((scrollRegion as HTMLElement).className).toContain("overflow-y-auto");
    expect((scrollRegion as HTMLElement).className).toContain("min-h-0");
    expect((scrollRegion as HTMLElement).className).toContain("flex-1");

    // All 40 cards live inside that single scroll container.
    expect(within(scrollRegion as HTMLElement).getByText("Card 0")).toBeInTheDocument();
    expect(within(scrollRegion as HTMLElement).getByText("Card 39")).toBeInTheDocument();
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
            priority: "normal",
            previewTasks: [],
            footerLabel: "Completed",
            animatedLabel: null,
            tags: [],
            targetVersion: null,
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
