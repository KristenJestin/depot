// @vitest-environment happy-dom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  MilestonePageView,
  type MilestoneViewItem,
  type MilestoneViewSummary,
} from "#/web/routes/milestones.$version";

/**
 * PRD 0019 / T4 — `/milestones/<v>` page render test.
 *
 * The route is exercised by rendering its inner view component directly so
 * the test stays free of router boilerplate. Verifies:
 *   - Headline "<v> — X / Y PRDs done" reads from `summary.byStatus.done`
 *     and total (excluding canceled).
 *   - Completion gauge `aria-valuenow` matches the computed percentage.
 *   - The 3 PRD items render with their title and status badges.
 */

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    className,
    to: _to,
    params: _params,
    ...props
  }: {
    children?: React.ReactNode;
    className?: string;
    to?: unknown;
    params?: unknown;
  } & React.ComponentPropsWithoutRef<"a">) => (
    <a href="#" className={className} {...props}>
      {children}
    </a>
  ),
  createFileRoute: () => () => ({}),
  useNavigate: () => () => undefined,
}));

describe("MilestonePageView (PRD 0019 / T4)", () => {
  const summary: MilestoneViewSummary = {
    version: "2.6.1",
    total: 3,
    byStatus: { done: 2, in_progress: 1, draft: 0, ready: 0, review: 0, canceled: 0 },
  };
  const items: MilestoneViewItem[] = [
    { id: "rev-a", title: "Tags lib", status: "done" },
    { id: "rev-b", title: "Deps DAG", status: "done" },
    { id: "rev-c", title: "Milestones UI", status: "in_progress" },
  ];

  it("renders the X / Y headline and 3 PRD items with statuses", () => {
    render(
      <MilestonePageView
        version="2.6.1"
        data={{ summary, items }}
        statusFilter="all"
        onStatusClick={() => undefined}
      />,
    );

    const headline = screen.getByTestId("milestone-headline");
    expect(headline).toHaveTextContent("2.6.1");
    expect(headline).toHaveTextContent("2 / 3 PRDs done");

    const list = screen.getByTestId("milestone-items");
    const lis = within(list).getAllByRole("listitem");
    expect(lis).toHaveLength(3);
    expect(within(list).getByText("Tags lib")).toBeInTheDocument();
    expect(within(list).getByText("Deps DAG")).toBeInTheDocument();
    expect(within(list).getByText("Milestones UI")).toBeInTheDocument();
  });

  it("reports the correct completion percent on the gauge (2/3 ≈ 67%)", () => {
    render(
      <MilestonePageView
        version="2.6.1"
        data={{ summary, items }}
        statusFilter="all"
        onStatusClick={() => undefined}
      />,
    );
    const gauge = screen.getByTestId("milestone-gauge");
    expect(gauge.getAttribute("aria-valuenow")).toBe("67");
  });

  it("filtering by a status reduces the visible list", () => {
    render(
      <MilestonePageView
        version="2.6.1"
        data={{ summary, items }}
        statusFilter="done"
        onStatusClick={() => undefined}
      />,
    );
    const list = screen.getByTestId("milestone-items");
    const lis = within(list).getAllByRole("listitem");
    expect(lis).toHaveLength(2);
    expect(within(list).queryByText("Milestones UI")).not.toBeInTheDocument();
  });
});
