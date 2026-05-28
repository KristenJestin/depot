// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";

import { StageTimeline } from "#/web/components/stage-timeline";
import { buildStageCards } from "#/web/lib/prd-view-model";

type DetailData = Parameters<typeof buildStageCards>[0];
type DetailPrd = DetailData["prd"];
type DetailTask = DetailData["tasks"][number];

const NOW = "2026-05-25T10:00:00.000Z";

function makePrd(status: DetailPrd["status"], currentPhase: DetailPrd["currentPhase"]): DetailPrd {
  return {
    id: "rev-1",
    prdId: "prd-1",
    projectId: "proj-1",
    workspaceId: null,
    revision: 1,
    title: "Timeline PRD",
    context: null,
    scope: null,
    problem: null,
    solution: null,
    implementationDecisions: null,
    testingDecisions: null,
    status,
    auditCycles: 0,
    currentPhase,
    supersededAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    readyAt: NOW,
    activatedAt: status === "draft" || status === "ready" ? null : NOW,
    suggestedCommitMessage: null,
  };
}

function makeTask(phase: number, status: DetailTask["status"] = "pending"): DetailTask {
  return {
    id: `phase-${phase}-task`,
    prdRevisionId: "rev-1",
    position: phase,
    title: `Task in phase ${phase}`,
    description: "Intent:\nplaceholder",
    descriptionFormat: "structured_v1",
    doneCriteria: "Phase done",
    dependsOn: "[]",
    effort: "m",
    kind: "slice",
    phaseNumber: phase,
    status,
    reviewId: null,
    severity: null,
    axis: null,
    repoId: null,
    triageState: "ready-for-agent",
    linkedFilePath: null,
    linkedStartLine: null,
    linkedEndLine: null,
    linkedDiffSha: null,
    blockedReason: null,
    skipReason: null,
    createdAt: NOW,
    startedAt: status === "pending" ? null : NOW,
    completedAt: status === "done" ? NOW : null,
  };
}

function makeData(
  status: DetailPrd["status"],
  currentPhase: DetailPrd["currentPhase"],
  tasks: DetailTask[],
): DetailData {
  return {
    prd: makePrd(status, currentPhase),
    tasks,
    reviews: [],
    revisions: [],
    activity: [],
  };
}

/**
 * The implementation card for a phase renders as an accordion trigger whose
 * label starts with "Implementation". When the card is open, the trigger
 * exposes `aria-expanded="true"`. We collect those triggers and assert open
 * state via aria-expanded rather than panel visibility because Base UI keeps
 * the panel mounted (keepMounted) and toggles its open data attribute.
 */
function getImplementationTriggers() {
  return screen.getAllByRole("button", { name: /^Implementation/ });
}

describe("StageTimeline", () => {
  it("draft + 3 phases + expandAll=true: no 'Future phases' section, all Implementation cards expanded", () => {
    const data = makeData("draft", null, [makeTask(1), makeTask(2), makeTask(3)]);
    const cards = buildStageCards(data);

    render(<StageTimeline cards={cards} expandAll />);

    expect(screen.queryByText("Future phases")).not.toBeInTheDocument();

    const triggers = getImplementationTriggers();
    expect(triggers).toHaveLength(3);
    for (const trigger of triggers) {
      expect(trigger).toHaveAttribute("aria-expanded", "true");
    }
  });

  it("ready + 3 phases + expandAll=true: no 'Future phases' section, all Implementation cards expanded", () => {
    const data = makeData("ready", null, [makeTask(1), makeTask(2), makeTask(3)]);
    const cards = buildStageCards(data);

    render(<StageTimeline cards={cards} expandAll />);

    expect(screen.queryByText("Future phases")).not.toBeInTheDocument();

    const triggers = getImplementationTriggers();
    expect(triggers).toHaveLength(3);
    for (const trigger of triggers) {
      expect(trigger).toHaveAttribute("aria-expanded", "true");
    }
  });

  it("in_progress + 3 phases + expandAll=false: 'Future phases' section present, only the current phase card is expanded", () => {
    const data = makeData("in_progress", 2, [
      makeTask(1, "done"),
      makeTask(2, "in_progress"),
      makeTask(3),
    ]);
    const cards = buildStageCards(data);

    render(<StageTimeline cards={cards} expandAll={false} />);

    expect(screen.getByText("Future phases")).toBeInTheDocument();

    // Only the current phase (phase 2) work card is expanded by default.
    // The future phase 3 card lives inside the collapsed "Future phases"
    // section, so it isn't an active accordion in the open tree; the
    // remaining visible Implementation triggers belong to phase 1 (passed)
    // and phase 2 (current). Of those, only phase 2 is expanded.
    const triggers = getImplementationTriggers();
    const expanded = triggers.filter((t) => t.getAttribute("aria-expanded") === "true");
    expect(expanded).toHaveLength(1);
  });
});
