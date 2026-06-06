// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";

import { PrdHeaderCard } from "#/web/components/prd-header-card";
import type { DetailSummary } from "#/web/lib/prd-view-model";
import type { PrdDetailResponse } from "#/web/lib/api-types";

/**
 * PRD 0026 / S2 — the header card no longer renders a `StatusBadge`
 * (status lives only in the sidebar Info widget). The editable priority badge
 * was likewise moved to the sidebar Info, so the header carries no priority.
 * Only the `superseded` outline badge stays when the PRD is superseded.
 */

const NOW = "2026-05-20T10:00:00.000Z";

const BASE_PRD: PrdDetailResponse["prd"] = {
  id: "prd-1",
  prdId: "prd-family",
  projectId: "proj-1",
  workspaceId: null,
  revision: 1,
  title: "Header card PRD",
  context: null,
  scope: null,
  problem: null,
  solution: null,
  implementationDecisions: null,
  testingDecisions: null,
  priority: "low",
  status: "in_progress",
  auditCycles: 0,
  currentPhase: 1,
  supersededAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  readyAt: NOW,
  activatedAt: NOW,
  suggestedCommitMessage: null,
};

const SUMMARY: DetailSummary = {
  totalTasks: 0,
  doneTasks: 0,
  pendingTasks: 0,
  inProgressTasks: 0,
  blockedTasks: 0,
  skippedTasks: 0,
  activeReview: null,
  currentCycleLabel: null,
};

function renderHeader(prd: PrdDetailResponse["prd"]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PrdHeaderCard prd={prd} summary={SUMMARY} />
    </QueryClientProvider>,
  );
}

describe("PrdHeaderCard", () => {
  it("does not render the priority badge in the header (moved to sidebar Info)", () => {
    renderHeader(BASE_PRD);

    expect(screen.queryByRole("combobox", { name: "PRD priority" })).not.toBeInTheDocument();
  });

  it("does not render the StatusBadge in the header (moved to sidebar Info)", () => {
    renderHeader(BASE_PRD);

    // The StatusBadge for `in_progress` renders the human label "In progress".
    expect(screen.queryByText(/^In progress$/)).not.toBeInTheDocument();
    // And `Draft` for a draft PRD.
    const { unmount } = renderHeader({ ...BASE_PRD, status: "draft" });
    expect(screen.queryByText(/^Draft$/)).not.toBeInTheDocument();
    unmount();
  });

  it("keeps the `superseded` outline badge for a superseded PRD", () => {
    renderHeader({
      ...BASE_PRD,
      supersededAt: NOW,
    });
    expect(screen.getByText("superseded")).toBeInTheDocument();
  });

  it("does not render a `superseded` badge when the PRD is current", () => {
    renderHeader(BASE_PRD);
    expect(screen.queryByText("superseded")).not.toBeInTheDocument();
  });
});
