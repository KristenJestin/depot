// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { KanbanBoard } from "#/web/components/kanban-board";
import { PrdTagsWidget } from "#/web/components/prd-groupings-widget";
import type { BoardColumn } from "#/web/lib/prd-view-model";

/**
 * RTL coverage for PRD 0019 / T4 — the three new UI surfaces:
 *   1. Kanban PRD card renders tag + milestone badges (list page).
 *   2. PrdTagsWidget submits POST `/api/prds/:id/tags` and invalidates the
 *      detail/list queries on success (detail page).
 *   3. Milestone page coverage lives in `milestones-page.render.test.tsx`
 *      to keep this file focused on the kanban list + detail widgets.
 */

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

describe("KanbanPrdCard tags + milestone badges (PRD 0019 / T4)", () => {
  it("renders a milestone badge and tag badges on the kanban card", () => {
    const columns: BoardColumn[] = [
      {
        id: "in_progress",
        title: "In Progress",
        cards: [
          {
            id: "rev-1",
            prdId: "prd-1",
            projectId: "proj-1",
            projectName: "Acme",
            title: "Tagged PRD",
            context: null,
            status: "in_progress",
            priority: "normal",
            updatedAt: "2026-04-30T10:00:00.000Z",
            totalTasks: 2,
            doneTasks: 1,
            blockedTasks: 0,
            inProgressTasks: 1,
            skippedTasks: 0,
            latestReview: null,
            previewTasks: [],
            footerLabel: "in progress",
            animatedLabel: null,
            tags: ["agent-friendliness", "tests-e2e"],
            targetVersion: "2.6.1",
          },
        ],
      },
    ];

    render(<KanbanBoard columns={columns} />);

    const milestone = screen.getByTestId("milestone-badge");
    expect(milestone).toHaveTextContent("2.6.1");
    const tagBadges = screen.getAllByTestId("tag-badge");
    expect(tagBadges).toHaveLength(2);
    expect(tagBadges.map((node) => node.textContent)).toEqual(
      expect.arrayContaining(["agent-friendliness", "tests-e2e"]),
    );
  });
});

describe("PrdTagsWidget — POST + cache invalidation (PRD 0019 / T4)", () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("calls POST /api/prds/:id/tags and invalidates the prds query on success", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return new Response(JSON.stringify({ item: { prdId: "prd-1", tag: "shipped" } }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    render(
      <QueryClientProvider client={queryClient}>
        <PrdTagsWidget prdRevisionId="rev-1" tags={["existing"]} />
      </QueryClientProvider>,
    );

    expect(screen.getByText("existing")).toBeInTheDocument();

    const input = screen.getByLabelText("Add tag") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "shipped" } });
    const button = screen.getByRole("button", { name: /^Add$/ });
    await act(async () => {
      fireEvent.click(button);
      // let useMutation settle
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/prds/rev-1/tags");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ tag: "shipped" }));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["prds"] });
  });
});
