// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PrdSidebar } from "#/web/components/prd-sidebar";
import type { DetailSummary, RevisionEntry } from "#/web/lib/prd-view-model";

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

describe("PrdSidebar", () => {
  it("hides empty reviews and bounds the activity list", () => {
    const now = "2026-04-30T10:00:00.000Z";
    const summary: DetailSummary = {
      totalTasks: 2,
      doneTasks: 1,
      pendingTasks: 1,
      inProgressTasks: 0,
      blockedTasks: 0,
      skippedTasks: 0,
      activeReview: null,
      currentCycleLabel: "Initial run",
    };
    const revisions: RevisionEntry[] = [
      {
        id: "rev-1",
        revision: 1,
        status: "in_progress",
        createdAt: now,
        isHead: true,
        isCurrentView: true,
        superseded: false,
      },
    ];

    render(
      <PrdSidebar
        prd={{
          id: "rev-1",
          prdId: "prd-1",
          projectId: "proj-1",
          workspaceId: "ws-1",
          revision: 1,
          title: "Sidebar PRD",
          context: null,
          scope: null,
          problem: null,
          solution: null,
          implementationDecisions: null,
          testingDecisions: null,
          status: "in_progress",
          auditCycles: 1,
          currentPhase: 1,
          supersededAt: null,
          createdAt: now,
          updatedAt: now,
          readyAt: now,
          activatedAt: now,

          activatedAtSha: null,

          doneAtSha: null,

          mergedAtSha: null,

          suggestedCommitMessage: null,

          worktreePath: null,
        }}
        workspace={{ id: "ws-1", path: "D:/Projects/depot", label: "depot" }}
        revisions={revisions}
        reviews={[]}
        activity={[
          {
            id: "activity-1",
            taskId: null,
            eventType: "prd_activated",
            payload: {},
            createdAt: now,
          },
        ]}
        summary={summary}
      />,
    );

    expect(screen.queryByRole("heading", { name: "Reviews" })).not.toBeInTheDocument();

    const activityHeading = screen.getByRole("heading", { name: "Activity" });
    const activityCard = activityHeading.parentElement?.querySelector(
      ".max-h-\\[420px\\].overflow-y-auto",
    );

    expect(activityCard).not.toBeNull();
  });
});
