import { describe, expect, it } from "vite-plus/test";

import { buildBoardColumns, buildDetailSummary, buildStageCards } from "#/web/lib/prd-view-model";

describe("prd view model", () => {
  it("counts skipped base tasks as complete and keeps the current cycle on the latest review", () => {
    const now = "2026-04-30T10:00:00.000Z";
    const data: Parameters<typeof buildDetailSummary>[0] = {
      prd: {
        id: "rev-1",
        prdId: "prd-1",
        projectId: "proj-1",
        workspaceId: null,
        revision: 1,
        title: "Review cycle PRD",
        context: null,
        scope: null,
        problem: null,
        solution: null,
        implementationDecisions: null,
        testingDecisions: null,
        status: "in_progress",
        auditCycles: 2,
        currentPhase: 3,
        supersededAt: null,
        createdAt: now,
        updatedAt: now,
        readyAt: now,
        activatedAt: now,
        suggestedCommitMessage: null,
      },
      tasks: [
        {
          id: "task-1",
          prdRevisionId: "rev-1",
          position: 1,
          title: "Implement dashboard",
          description: "Intent:\nShip the dashboard\n\nScope:\n- Render the board",
          descriptionFormat: "structured_v1",
          doneCriteria: "Dashboard renders",
          dependsOn: "[]",
          effort: "m",
          kind: "slice",
          phaseNumber: null,
          status: "done",
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
          createdAt: now,
          startedAt: now,
          completedAt: now,
        },
        {
          id: "task-2",
          prdRevisionId: "rev-1",
          position: 2,
          title: "Retire legacy view",
          description: "Intent:\nRetire the legacy view",
          descriptionFormat: "structured_v1",
          doneCriteria: "Legacy view removed",
          dependsOn: "[]",
          effort: "s",
          kind: "slice",
          phaseNumber: null,
          status: "skipped",
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
          skipReason: "Handled by the new route",
          createdAt: now,
          startedAt: null,
          completedAt: now,
        },
      ],
      reviews: [
        {
          id: "review-1",
          type: "human",
          status: "done",
          phaseNumber: 3,
          createdAt: now,
          doneAt: now,
          userFeedback: "Please tighten the drawer flow.",
          findings: [
            {
              id: "finding-1",
              prdRevisionId: "rev-1",
              position: 3,
              title: "Move task links into the drawer",
              description: "Intent:\nKeep task navigation in one place",
              descriptionFormat: "structured_v1",
              doneCriteria: "All findings open the drawer",
              dependsOn: "[]",
              effort: "s",
              kind: "slice",
              phaseNumber: 3,
              status: "blocked",
              reviewId: "review-1",
              severity: "major",
              axis: null,
              repoId: null,
              triageState: "ready-for-agent",
              linkedFilePath: null,
              linkedStartLine: null,
              linkedEndLine: null,
              linkedDiffSha: null,
              blockedReason: "Waiting on route updates",
              skipReason: null,
              createdAt: now,
              startedAt: now,
              completedAt: null,
            },
          ],
        },
      ],
      revisions: [
        {
          id: "rev-1",
          prdId: "prd-1",
          projectId: "proj-1",
          workspaceId: null,
          revision: 1,
          title: "Review cycle PRD",
          context: null,
          scope: null,
          problem: null,
          solution: null,
          implementationDecisions: null,
          testingDecisions: null,
          status: "in_progress",
          auditCycles: 2,
          currentPhase: 3,
          supersededAt: null,
          createdAt: now,
          updatedAt: now,
          readyAt: now,
          activatedAt: now,
          suggestedCommitMessage: null,
        },
      ],
      activity: [],
    };

    expect(buildDetailSummary(data)).toMatchObject({
      totalTasks: 2,
      doneTasks: 2,
      skippedTasks: 1,
      blockedTasks: 0,
      currentCycleLabel: "Human Review #3",
    });
  });

  it("keeps agent reviews in progress and reserves the review column for human review", () => {
    const now = "2026-04-30T10:00:00.000Z";
    const columns = buildBoardColumns([
      {
        id: "rev-agent",
        prdId: "prd-agent",
        projectId: "proj-1",
        projectName: "Acme",
        workspaceId: "ws-1",
        revision: 1,
        title: "Agent audit PRD",
        context: null,
        scope: null,
        problem: null,
        solution: null,
        implementationDecisions: null,
        testingDecisions: null,
        status: "in_progress",
        auditCycles: 1,
        currentPhase: null,
        supersededAt: null,
        createdAt: now,
        updatedAt: now,
        readyAt: now,
        activatedAt: now,
        suggestedCommitMessage: null,
        totalTasks: 3,
        doneTasks: 1,
        blockedTasks: 0,
        inProgressTasks: 1,
        skippedTasks: 0,
        latestReview: {
          id: "review-agent",
          prdRevisionId: "rev-agent",
          type: "agent",
          status: "in_progress",
          createdAt: now,
          doneAt: null,
          findingsCount: 0,
          resolvedCount: 0,
          activeCount: 0,
          pendingCount: 0,
          criticalCount: 0,
          majorCount: 0,
          minorCount: 0,
          infoCount: 0,
        },
        previewTasks: [],
      },
      {
        id: "rev-human",
        prdId: "prd-human",
        projectId: "proj-1",
        projectName: "Acme",
        workspaceId: "ws-1",
        revision: 1,
        title: "Human review PRD",
        context: null,
        scope: null,
        problem: null,
        solution: null,
        implementationDecisions: null,
        testingDecisions: null,
        status: "in_progress",
        auditCycles: 1,
        currentPhase: null,
        supersededAt: null,
        createdAt: now,
        updatedAt: now,
        readyAt: now,
        activatedAt: now,
        suggestedCommitMessage: null,
        totalTasks: 2,
        doneTasks: 2,
        blockedTasks: 0,
        inProgressTasks: 0,
        skippedTasks: 0,
        latestReview: {
          id: "review-human",
          prdRevisionId: "rev-human",
          type: "human",
          status: "in_progress",
          createdAt: now,
          doneAt: null,
          findingsCount: 0,
          resolvedCount: 0,
          activeCount: 0,
          pendingCount: 0,
          criticalCount: 0,
          majorCount: 0,
          minorCount: 0,
          infoCount: 0,
        },
        previewTasks: [],
      },
    ]);

    expect(
      columns.find((column) => column.id === "in_progress")?.cards.map((card) => card.id),
    ).toEqual(["rev-agent"]);
    expect(columns.find((column) => column.id === "review")?.cards.map((card) => card.id)).toEqual([
      "rev-human",
    ]);
  });

  it("keeps the current cycle on agent audit until the review is closed", () => {
    const now = "2026-04-30T10:00:00.000Z";
    const data: Parameters<typeof buildDetailSummary>[0] = {
      prd: {
        id: "rev-agent-open",
        prdId: "prd-agent-open",
        projectId: "proj-1",
        workspaceId: null,
        revision: 1,
        title: "Agent audit open",
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
        suggestedCommitMessage: null,
      },
      tasks: [],
      reviews: [
        {
          id: "review-agent-open",
          type: "agent",
          status: "in_progress",
          phaseNumber: 1,
          createdAt: now,
          doneAt: null,
          userFeedback: null,
          findings: [
            {
              id: "finding-agent-open",
              prdRevisionId: "rev-agent-open",
              position: 1,
              title: "Tighten the copy",
              description: "Intent:\nTighten the copy",
              descriptionFormat: "structured_v1",
              doneCriteria: "Copy tightened",
              dependsOn: "[]",
              effort: "xs",
              kind: "slice",
              phaseNumber: 1,
              status: "pending",
              reviewId: "review-agent-open",
              severity: "minor",
              axis: null,
              repoId: null,
              triageState: "ready-for-agent",
              linkedFilePath: null,
              linkedStartLine: null,
              linkedEndLine: null,
              linkedDiffSha: null,
              blockedReason: null,
              skipReason: null,
              createdAt: now,
              startedAt: null,
              completedAt: null,
            },
          ],
        },
      ],
      revisions: [],
      activity: [],
    };

    expect(buildDetailSummary(data).currentCycleLabel).toBe("Agent Audit #1");
  });

  it("builds canceled review stages and marks the latest review as the current cycle", () => {
    const now = "2026-04-30T10:00:00.000Z";
    const data: Parameters<typeof buildStageCards>[0] = {
      prd: {
        id: "rev-2",
        prdId: "prd-2",
        projectId: "proj-1",
        workspaceId: null,
        revision: 2,
        title: "Canceled PRD",
        context: null,
        scope: null,
        problem: null,
        solution: null,
        implementationDecisions: null,
        testingDecisions: null,
        status: "canceled",
        auditCycles: 1,
        currentPhase: 2,
        supersededAt: null,
        createdAt: now,
        updatedAt: now,
        readyAt: now,
        activatedAt: now,
        suggestedCommitMessage: null,
      },
      tasks: [
        {
          id: "task-3",
          prdRevisionId: "rev-2",
          position: 1,
          title: "Initial task",
          description: "Intent:\nStart the implementation",
          descriptionFormat: "structured_v1",
          doneCriteria: "Initial task finished",
          dependsOn: "[]",
          effort: "m",
          kind: "slice",
          phaseNumber: null,
          status: "done",
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
          createdAt: now,
          startedAt: now,
          completedAt: now,
        },
      ],
      reviews: [
        {
          id: "review-2",
          type: "human",
          status: "done",
          phaseNumber: 2,
          createdAt: now,
          doneAt: now,
          userFeedback: "Paused until the next revision.",
          findings: [
            {
              id: "finding-2",
              prdRevisionId: "rev-2",
              position: 2,
              title: "Update the blocked state copy",
              description: "Intent:\nClarify the canceled state",
              descriptionFormat: "structured_v1",
              doneCriteria: "Canceled state is clear",
              dependsOn: "[]",
              effort: "xs",
              kind: "slice",
              phaseNumber: 2,
              status: "in_progress",
              reviewId: "review-2",
              severity: "minor",
              axis: null,
              repoId: null,
              triageState: "ready-for-agent",
              linkedFilePath: null,
              linkedStartLine: null,
              linkedEndLine: null,
              linkedDiffSha: null,
              blockedReason: null,
              skipReason: null,
              createdAt: now,
              startedAt: now,
              completedAt: null,
            },
          ],
        },
      ],
      revisions: [
        {
          id: "rev-2",
          prdId: "prd-2",
          projectId: "proj-1",
          workspaceId: null,
          revision: 2,
          title: "Canceled PRD",
          context: null,
          scope: null,
          problem: null,
          solution: null,
          implementationDecisions: null,
          testingDecisions: null,
          status: "canceled",
          auditCycles: 1,
          currentPhase: 2,
          supersededAt: null,
          createdAt: now,
          updatedAt: now,
          readyAt: now,
          activatedAt: now,
          suggestedCommitMessage: null,
        },
      ],
      activity: [],
    };

    const stages = buildStageCards(data);

    expect(stages).toHaveLength(2);
    expect(stages.map((s) => s.id)).not.toContain("rework-review-2");

    const reviewStage = stages.find((s) => s.id === "review-review-2");
    expect(reviewStage).toMatchObject({
      id: "review-review-2",
      title: "Human Review #2",
      complete: true,
      current: true,
    });
  });

  it("folds agent follow-ups into the audit stage", () => {
    const now = "2026-04-30T10:00:00.000Z";
    const data: Parameters<typeof buildStageCards>[0] = {
      prd: {
        id: "rev-3",
        prdId: "prd-3",
        projectId: "proj-1",
        workspaceId: null,
        revision: 1,
        title: "Agent follow-up PRD",
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
        suggestedCommitMessage: null,
      },
      tasks: [
        {
          id: "task-4",
          prdRevisionId: "rev-3",
          position: 1,
          title: "Initial task",
          description: "Intent:\nBuild the feature",
          descriptionFormat: "structured_v1",
          doneCriteria: "Feature built",
          dependsOn: "[]",
          effort: "m",
          kind: "slice",
          phaseNumber: null,
          status: "done",
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
          createdAt: now,
          startedAt: now,
          completedAt: now,
        },
      ],
      reviews: [
        {
          id: "review-3",
          type: "agent",
          status: "done",
          phaseNumber: 1,
          createdAt: now,
          doneAt: now,
          userFeedback: null,
          findings: [
            {
              id: "finding-3",
              prdRevisionId: "rev-3",
              position: 2,
              title: "Tighten validation",
              description: "Intent:\nTighten validation",
              descriptionFormat: "structured_v1",
              doneCriteria: "Validation tightened",
              dependsOn: "[]",
              effort: "s",
              kind: "slice",
              phaseNumber: 1,
              status: "pending",
              reviewId: "review-3",
              severity: "minor",
              axis: null,
              repoId: null,
              triageState: "ready-for-agent",
              linkedFilePath: null,
              linkedStartLine: null,
              linkedEndLine: null,
              linkedDiffSha: null,
              blockedReason: null,
              skipReason: null,
              createdAt: now,
              startedAt: null,
              completedAt: null,
            },
          ],
        },
      ],
      revisions: [],
      activity: [],
    };

    const stages = buildStageCards(data);

    expect(stages).toHaveLength(2);
    expect(stages[0]).toMatchObject({
      id: "review-review-3",
      title: "Agent Audit #1",
      reviewType: "agent",
      current: true,
    });
    expect(stages.map((stage) => stage.id)).not.toContain("rework-review-3");
  });

  it("groups phased base tasks and keeps future phases visible", () => {
    const now = "2026-04-30T10:00:00.000Z";
    const data: Parameters<typeof buildStageCards>[0] = {
      prd: {
        id: "rev-phases",
        prdId: "prd-phases",
        projectId: "proj-1",
        workspaceId: null,
        revision: 1,
        title: "Phased PRD",
        context: null,
        scope: null,
        problem: null,
        solution: null,
        implementationDecisions: null,
        testingDecisions: null,
        status: "ready",
        auditCycles: 0,
        currentPhase: 1,
        supersededAt: null,
        createdAt: now,
        updatedAt: now,
        readyAt: now,
        activatedAt: now,
        suggestedCommitMessage: null,
      },
      tasks: [
        {
          id: "phase-1-task",
          prdRevisionId: "rev-phases",
          position: 1,
          title: "Build the first phase",
          description: "Intent:\nBuild the first phase",
          descriptionFormat: "structured_v1",
          doneCriteria: "First phase built",
          dependsOn: "[]",
          effort: "m",
          kind: "slice",
          phaseNumber: 1,
          status: "pending",
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
          createdAt: now,
          startedAt: null,
          completedAt: null,
        },
        {
          id: "phase-2-task",
          prdRevisionId: "rev-phases",
          position: 2,
          title: "Prepare the second phase",
          description: "Intent:\nPrepare the second phase",
          descriptionFormat: "structured_v1",
          doneCriteria: "Second phase prepared",
          dependsOn: "[]",
          effort: "s",
          kind: "slice",
          phaseNumber: 2,
          status: "pending",
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
          createdAt: now,
          startedAt: null,
          completedAt: null,
        },
      ],
      reviews: [],
      revisions: [],
      activity: [],
    };

    const stages = buildStageCards(data);
    const byPhase = new Map(stages.map((s) => [s.phaseNumber, s] as const));

    expect(new Set(stages.map((s) => s.id))).toEqual(new Set(["phase-1", "phase-2"]));
    expect(byPhase.get(1)).toMatchObject({
      title: "Phase 1",
      phaseNumber: 1,
      current: true,
      // Pre-activation (ready): no phase is `future` — all phases render at
      // the same level for the author to vet the plan.
      future: false,
    });
    expect(byPhase.get(2)).toMatchObject({
      title: "Phase 2",
      phaseNumber: 2,
      current: false,
      future: false,
    });
    expect(byPhase.get(2)?.items.map((item) => item.title)).toEqual(["Prepare the second phase"]);
  });

  it("treats phase 1 as the implicit current phase for a not-yet-activated PRD", () => {
    const now = "2026-04-30T10:00:00.000Z";
    const data: Parameters<typeof buildStageCards>[0] = {
      prd: {
        id: "rev-ready",
        prdId: "prd-ready",
        projectId: "proj-1",
        workspaceId: null,
        revision: 1,
        title: "Ready PRD with three phases",
        context: null,
        scope: null,
        problem: null,
        solution: null,
        implementationDecisions: null,
        testingDecisions: null,
        status: "ready",
        auditCycles: 0,
        currentPhase: null,
        supersededAt: null,
        createdAt: now,
        updatedAt: now,
        readyAt: now,
        activatedAt: null,
        suggestedCommitMessage: null,
      },
      tasks: [1, 2, 3].map((phase) => ({
        id: `phase-${phase}-task`,
        prdRevisionId: "rev-ready",
        position: phase,
        title: `Task in phase ${phase}`,
        description: "Intent:\nPlaceholder",
        descriptionFormat: "structured_v1",
        doneCriteria: "Phase done",
        dependsOn: "[]",
        effort: "m",
        kind: "slice",
        phaseNumber: phase,
        status: "pending",
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
        createdAt: now,
        startedAt: null,
        completedAt: null,
      })),
      reviews: [],
      revisions: [],
      activity: [],
    };

    const stages = buildStageCards(data);
    const byPhase = new Map(stages.map((s) => [s.phaseNumber, s] as const));

    expect(new Set(stages.map((s) => s.id))).toEqual(new Set(["phase-1", "phase-2", "phase-3"]));
    expect(byPhase.get(1)).toMatchObject({
      phaseNumber: 1,
      current: true,
      // Pre-activation (ready) with no explicit currentPhase: phase 1 is the
      // implicit "next current", but no phase is `future` — the planner sees
      // all phases at the same visual level.
      future: false,
    });
    expect(byPhase.get(2)).toMatchObject({ phaseNumber: 2, current: false, future: false });
    expect(byPhase.get(3)).toMatchObject({ phaseNumber: 3, current: false, future: false });
  });

  it("attributes an unphased agent review to the closest phase on a phased PRD", () => {
    const now = "2026-05-13T10:00:00.000Z";
    const data: Parameters<typeof buildStageCards>[0] = {
      prd: {
        id: "rev-phased-orphan",
        prdId: "prd-orphan",
        projectId: "proj-1",
        workspaceId: null,
        revision: 1,
        title: "Phased PRD with an unphased agent review",
        context: null,
        scope: null,
        problem: null,
        solution: null,
        implementationDecisions: null,
        testingDecisions: null,
        status: "in_progress",
        auditCycles: 1,
        currentPhase: null,
        supersededAt: null,
        createdAt: now,
        updatedAt: now,
        readyAt: now,
        activatedAt: now,
        suggestedCommitMessage: null,
      },
      tasks: [1, 2, 3].map((phase) => ({
        id: `phase-${phase}-task`,
        prdRevisionId: "rev-phased-orphan",
        position: phase,
        title: `Task in phase ${phase}`,
        description: "Intent:\nplaceholder",
        descriptionFormat: "structured_v1",
        doneCriteria: "Phase done",
        dependsOn: "[]",
        effort: "m",
        kind: "slice",
        phaseNumber: phase,
        status: phase === 1 ? "done" : "pending",
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
        createdAt: now,
        startedAt: phase === 1 ? now : null,
        completedAt: phase === 1 ? now : null,
      })),
      reviews: [
        {
          id: "agent-review-orphan",
          type: "agent",
          status: "draft",
          phaseNumber: null,
          createdAt: now,
          doneAt: null,
          userFeedback: null,
          findings: [],
        },
      ],
      revisions: [],
      activity: [],
    };

    const stages = buildStageCards(data);

    // Bug repro: pre-fix, a phased PRD with an unphased agent review produced
    // a stray "initial-run"-keyed phase in the timeline AND attributed its
    // findings to the highest phase number (a phase the user hasn't started
    // yet). After the fix, the audit pins to the most recently active phase
    // — here phase 1, the only one with any started work. The card carries
    // only the synthetic audit-marker item; orphan findings are hidden from
    // the timeline.
    expect(stages.map((s) => s.id)).toEqual([
      "phase-1",
      "phase-2",
      "phase-3",
      "review-agent-review-orphan",
    ]);
    const reviewCard = stages.find((s) => s.id === "review-agent-review-orphan")!;
    expect(reviewCard.phaseNumber).toBe(1);
    expect(reviewCard.items).toHaveLength(1);
    expect(reviewCard.items[0]).toMatchObject({
      id: "audit-agent-review-orphan",
      title: "Agent audit #1",
      reviewId: "agent-review-orphan",
      status: "pending",
    });
  });

  it("folds unphased agent review findings into the closest phase's work card", () => {
    const now = "2026-05-13T10:00:00.000Z";
    const findingId = "agent-finding";
    const data: Parameters<typeof buildStageCards>[0] = {
      prd: {
        id: "rev-phased-findings",
        prdId: "prd-findings",
        projectId: "proj-1",
        workspaceId: null,
        revision: 1,
        title: "Phased PRD, agent review with findings",
        context: null,
        scope: null,
        problem: null,
        solution: null,
        implementationDecisions: null,
        testingDecisions: null,
        status: "in_progress",
        auditCycles: 1,
        currentPhase: 2,
        supersededAt: null,
        createdAt: now,
        updatedAt: now,
        readyAt: now,
        activatedAt: now,
        suggestedCommitMessage: null,
      },
      tasks: [
        {
          id: "phase-1-task",
          prdRevisionId: "rev-phased-findings",
          position: 1,
          title: "Task in phase 1",
          description: "Intent:\nplaceholder",
          descriptionFormat: "structured_v1",
          doneCriteria: "Phase done",
          dependsOn: "[]",
          effort: "m",
          kind: "slice",
          phaseNumber: 1,
          status: "done",
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
          createdAt: now,
          startedAt: now,
          completedAt: now,
        },
        {
          id: "phase-2-task",
          prdRevisionId: "rev-phased-findings",
          position: 2,
          title: "Task in phase 2",
          description: "Intent:\nplaceholder",
          descriptionFormat: "structured_v1",
          doneCriteria: "Phase done",
          dependsOn: "[]",
          effort: "m",
          kind: "slice",
          phaseNumber: 2,
          status: "in_progress",
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
          createdAt: now,
          startedAt: now,
          completedAt: null,
        },
      ],
      reviews: [
        {
          id: "agent-review-findings",
          type: "agent",
          status: "in_progress",
          phaseNumber: null,
          createdAt: now,
          doneAt: null,
          userFeedback: null,
          findings: [
            {
              id: findingId,
              prdRevisionId: "rev-phased-findings",
              position: 1,
              title: "Audit finding",
              description: "Intent:\nplaceholder",
              descriptionFormat: "structured_v1",
              doneCriteria: "Fix the issue",
              dependsOn: "[]",
              effort: "s",
              kind: "slice",
              phaseNumber: null,
              status: "pending",
              reviewId: "agent-review-findings",
              severity: "minor",
              axis: null,
              repoId: null,
              triageState: "ready-for-agent",
              linkedFilePath: null,
              linkedStartLine: null,
              linkedEndLine: null,
              linkedDiffSha: null,
              blockedReason: null,
              skipReason: null,
              createdAt: now,
              startedAt: null,
              completedAt: null,
            },
          ],
        },
      ],
      revisions: [],
      activity: [],
    };

    const stages = buildStageCards(data);
    const reviewStage = stages.find((s) => s.id === "review-agent-review-findings");
    // Phase 2 is the explicit currentPhase here, and it has open work — both
    // signals point at phase 2.
    expect(reviewStage?.phaseNumber).toBe(2);
  });

  it("pins an unphased audit to the most recently active phase", () => {
    // Real-world repro: PRD with phase 1 fully done, phase 2 in_progress,
    // phase 3 only pending. An agent review created with phase_number=null
    // and 6 done findings was landing under phase 3 (max phase number),
    // which made phase 3 look like it had started. Correct attribution is
    // phase 2 (the mid-flight phase); orphan findings are also dropped from
    // the timeline entirely so they don't pollute any phase.
    const now = "2026-05-13T10:00:00.000Z";
    const data: Parameters<typeof buildStageCards>[0] = {
      prd: {
        id: "rev-real-bug",
        prdId: "prd-real-bug",
        projectId: "proj-1",
        workspaceId: null,
        revision: 1,
        title: "Phased PRD, phase 2 active, audit done with global findings",
        context: null,
        scope: null,
        problem: null,
        solution: null,
        implementationDecisions: null,
        testingDecisions: null,
        status: "in_progress",
        auditCycles: 1,
        currentPhase: null,
        supersededAt: null,
        createdAt: now,
        updatedAt: now,
        readyAt: now,
        activatedAt: now,
        suggestedCommitMessage: null,
      },
      tasks: [
        {
          id: "p1-t1",
          prdRevisionId: "rev-real-bug",
          position: 1,
          title: "P1 task",
          description: "Intent:\np",
          descriptionFormat: "structured_v1",
          doneCriteria: "—",
          dependsOn: "[]",
          effort: "m",
          kind: "slice",
          phaseNumber: 1,
          status: "done",
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
          createdAt: now,
          startedAt: now,
          completedAt: now,
        },
        {
          id: "p2-t1",
          prdRevisionId: "rev-real-bug",
          position: 2,
          title: "P2 task",
          description: "Intent:\np",
          descriptionFormat: "structured_v1",
          doneCriteria: "—",
          dependsOn: "[]",
          effort: "m",
          kind: "slice",
          phaseNumber: 2,
          status: "in_progress",
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
          createdAt: now,
          startedAt: now,
          completedAt: null,
        },
        {
          id: "p3-t1",
          prdRevisionId: "rev-real-bug",
          position: 3,
          title: "P3 task",
          description: "Intent:\np",
          descriptionFormat: "structured_v1",
          doneCriteria: "—",
          dependsOn: "[]",
          effort: "m",
          kind: "slice",
          phaseNumber: 3,
          status: "pending",
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
          createdAt: now,
          startedAt: null,
          completedAt: null,
        },
      ],
      reviews: [
        {
          id: "global-audit",
          type: "agent",
          status: "done",
          phaseNumber: null,
          createdAt: now,
          doneAt: now,
          userFeedback: null,
          findings: [
            {
              id: "finding-done",
              prdRevisionId: "rev-real-bug",
              position: 4,
              title: "A done finding",
              description: "Intent:\nfix",
              descriptionFormat: "structured_v1",
              doneCriteria: "—",
              dependsOn: "[]",
              effort: "s",
              kind: "slice",
              phaseNumber: null,
              status: "done",
              reviewId: "global-audit",
              severity: "minor",
              axis: null,
              repoId: null,
              triageState: "ready-for-agent",
              linkedFilePath: null,
              linkedStartLine: null,
              linkedEndLine: null,
              linkedDiffSha: null,
              blockedReason: null,
              skipReason: null,
              createdAt: now,
              startedAt: now,
              completedAt: now,
            },
          ],
        },
      ],
      revisions: [],
      activity: [],
    };

    const stages = buildStageCards(data);
    const reviewStage = stages.find((s) => s.id === "review-global-audit");
    // Mid-flight phase = 2 (has the in-progress task), NOT 3.
    expect(reviewStage?.phaseNumber).toBe(2);
    // Orphan findings hidden from the timeline; only the audit marker
    // surfaces. The user can still drill in via the review drawer.
    expect(reviewStage?.items).toHaveLength(1);
    expect(reviewStage?.items[0]?.id).toBe("audit-global-audit");
  });

  describe("isFuturePhase via buildStageCards `card.future`", () => {
    // The shape needed by buildStageCards. Inlined as a helper to keep the four
    // status-driven cases compact and aligned.
    type DetailPrd = Parameters<typeof buildStageCards>[0]["prd"];
    type DetailTask = Parameters<typeof buildStageCards>[0]["tasks"][number];

    const now = "2026-05-25T10:00:00.000Z";

    function makePrd(
      status: DetailPrd["status"],
      currentPhase: DetailPrd["currentPhase"],
    ): DetailPrd {
      return {
        id: "rev-future",
        prdId: "prd-future",
        projectId: "proj-1",
        workspaceId: null,
        revision: 1,
        title: "Future-phase PRD",
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
        createdAt: now,
        updatedAt: now,
        readyAt: now,
        activatedAt: status === "draft" || status === "ready" ? null : now,
        suggestedCommitMessage: null,
      };
    }

    function makeTask(phase: number, status: DetailTask["status"] = "pending"): DetailTask {
      return {
        id: `phase-${phase}-task`,
        prdRevisionId: "rev-future",
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
        createdAt: now,
        startedAt: status === "pending" ? null : now,
        completedAt: status === "done" ? now : null,
      };
    }

    function makeData(
      status: DetailPrd["status"],
      currentPhase: DetailPrd["currentPhase"],
      tasks: DetailTask[],
    ): Parameters<typeof buildStageCards>[0] {
      return {
        prd: makePrd(status, currentPhase),
        tasks,
        reviews: [],
        revisions: [],
        activity: [],
      };
    }

    it("draft PRD: no phase card is marked future (3 phases)", () => {
      const stages = buildStageCards(
        makeData("draft", null, [makeTask(1), makeTask(2), makeTask(3)]),
      );

      expect(new Set(stages.map((s) => s.id))).toEqual(new Set(["phase-1", "phase-2", "phase-3"]));
      expect(stages.every((s) => s.future === false)).toBe(true);
      // Preserve Q1 decision: phase 1 still flagged as current via markCurrentStage.
      expect(stages.find((s) => s.phaseNumber === 1)?.current).toBe(true);
    });

    it("ready PRD: no phase card is marked future (3 phases)", () => {
      const stages = buildStageCards(
        makeData("ready", null, [makeTask(1), makeTask(2), makeTask(3)]),
      );

      expect(new Set(stages.map((s) => s.id))).toEqual(new Set(["phase-1", "phase-2", "phase-3"]));
      expect(stages.every((s) => s.future === false)).toBe(true);
      expect(stages.find((s) => s.phaseNumber === 1)?.current).toBe(true);
    });

    it("in_progress PRD with currentPhase=2 / 3 phases: only phase 3 is future", () => {
      const stages = buildStageCards(
        makeData("in_progress", 2, [makeTask(1, "done"), makeTask(2, "in_progress"), makeTask(3)]),
      );

      const byPhase = new Map(stages.map((s) => [s.phaseNumber, s] as const));
      expect(byPhase.get(1)?.future).toBe(false);
      expect(byPhase.get(2)?.future).toBe(false);
      expect(byPhase.get(2)?.current).toBe(true);
      expect(byPhase.get(3)?.future).toBe(true);
    });

    it("done PRD: no phase card is marked future (regression guard)", () => {
      const stages = buildStageCards(
        makeData("done", 3, [makeTask(1, "done"), makeTask(2, "done"), makeTask(3, "done")]),
      );

      expect(stages.map((s) => s.future)).toEqual([false, false, false]);
    });
  });
});
