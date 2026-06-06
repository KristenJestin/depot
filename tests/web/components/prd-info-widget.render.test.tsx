// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";

import { PrdInfoWidget } from "#/web/components/prd-sidebar";
import type { DetailSummary } from "#/web/lib/prd-view-model";
import type { PrdDetailResponse } from "#/web/lib/api-types";

/**
 * The `PrdInfoWidget` carries the editable Priority row (the duplicate header
 * badge was removed): priority is shown and changed here via
 * `PrdPriorityBadgeEditable`, which needs a react-query client. Status and the
 * other rows are unchanged.
 */

const NOW = "2026-05-20T10:00:00.000Z";

const BASE_PRD: PrdDetailResponse["prd"] = {
  id: "prd-1",
  prdId: "prd-family",
  projectId: "proj-1",
  workspaceId: null,
  revision: 1,
  title: "Info widget PRD",
  context: null,
  scope: null,
  problem: null,
  solution: null,
  implementationDecisions: null,
  testingDecisions: null,
  priority: "high",
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

function renderInfo(prd: PrdDetailResponse["prd"]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PrdInfoWidget prd={prd} workspace={null} summary={SUMMARY} />
    </QueryClientProvider>,
  );
}

describe("PrdInfoWidget", () => {
  it("renders a Priority row with the PRD's current priority value", () => {
    renderInfo(BASE_PRD);

    const row = screen.getByText("Priority").closest("div");
    expect(row).not.toBeNull();
    // The badge sits in the value cell, so the same row contains "high".
    expect(row!.textContent).toContain("high");
  });

  it("falls back to `normal` when the priority is missing", () => {
    renderInfo({ ...BASE_PRD, priority: null as unknown as "normal" });

    const row = screen.getByText("Priority").closest("div");
    expect(row).not.toBeNull();
    expect(row!.textContent).toContain("normal");
  });
});
