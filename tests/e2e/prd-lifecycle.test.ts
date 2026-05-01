import { describe, expect, it } from "vitest";
import * as Activity from "#/modules/activity/domain";
import * as Projects from "#/modules/projects/domain";
import * as Prds from "#/modules/prds/domain";
import * as Reviews from "#/modules/reviews/domain";
import * as Tasks from "#/modules/tasks/domain";
import { createTestWorkspace, getTestDb, runE } from "./helpers";

describe("e2e prd lifecycle", () => {
  it("covers review lifecycle in the PRD flow without duplicating workflow transition tests", async () => {
    const project = await runE(Projects.createProject({ name: "e2e-prd-review-flow" }));
    const workspace = await createTestWorkspace(project.id, "/tmp/depot-e2e-review-flow");

    const { prd } = await runE(
      Prds.loadPrdBatch({
        projectId: project.id,
        title: "Review Flow PRD",
        ready: true,
        tasks: [
          {
            title: "Phase 1 task",
            description: "Implement phase 1",
            doneCriteria: "Phase 1 implemented",
            effort: "s",
            dependsOn: [],
            phaseNumber: 1,
          },
          {
            title: "Phase 2 task",
            description: "Implement phase 2",
            doneCriteria: "Phase 2 implemented",
            effort: "s",
            dependsOn: [],
            phaseNumber: 2,
          },
        ],
      }),
    );

    await runE(Prds.activatePrd(prd.id, workspace.id));

    const review = await runE(Reviews.createReview({ prdRevisionId: prd.id, type: "human" }));
    expect(review.status).toBe("draft");
    expect(review.phaseNumber).toBe(1);

    const updatedReview = await runE(
      Reviews.updateReview(review.id, { userFeedback: "Need stronger validation coverage" }),
    );
    expect(updatedReview.userFeedback).toBe("Need stronger validation coverage");

    const startedReview = await runE(Reviews.startReview(review.id));
    expect(startedReview.status).toBe("in_progress");

    const finding = await runE(
      Reviews.addReviewTask(review.id, {
        title: "Add validation tests",
        description: "Cover missing validation branches",
        doneCriteria: "Validation tests fail before fix and pass after",
        severity: "major",
      }),
    );
    expect(finding.reviewId).toBe(review.id);

    const startedFinding = await runE(Tasks.startTask(finding.id));
    expect(startedFinding.status).toBe("in_progress");

    const doneFinding = await runE(Tasks.completeTask(finding.id));
    expect(doneFinding.status).toBe("done");

    const doneReview = await runE(Reviews.doneReview(review.id));
    expect(doneReview.status).toBe("done");
    expect(doneReview.doneAt).toBeTruthy();

    const findings = await runE(Reviews.listReviewTasks(review.id));
    expect(findings.map((task) => task.status)).toEqual(["done"]);

    const activity = await runE(Activity.listActivityForRevision(prd.id));
    expect(activity.map((entry) => entry.eventType)).toEqual(
      expect.arrayContaining([
        "review_created",
        "review_updated",
        "review_started",
        "task_created",
        "task_started",
        "task_done",
        "review_done",
      ]),
    );
  });

  it("blocks phaseAdvance while the current phase has an open review", async () => {
    const project = await runE(Projects.createProject({ name: "e2e-phase-open-review" }));
    const workspace = await createTestWorkspace(project.id, "/tmp/depot-e2e-phase-open-review");

    const { prd, tasks } = await runE(
      Prds.loadPrdBatch({
        projectId: project.id,
        title: "Open Review Block PRD",
        ready: true,
        tasks: [
          {
            title: "Phase 1 task",
            description: "Implement phase 1",
            doneCriteria: "Phase 1 implemented",
            effort: "s",
            dependsOn: [],
            phaseNumber: 1,
          },
          {
            title: "Phase 2 task",
            description: "Implement phase 2",
            doneCriteria: "Phase 2 implemented",
            effort: "s",
            dependsOn: [],
            phaseNumber: 2,
          },
        ],
      }),
    );

    await runE(Prds.activatePrd(prd.id, workspace.id));
    await runE(Tasks.startTask(tasks[0]!.id));
    await runE(Tasks.completeTask(tasks[0]!.id));

    const review = await runE(Reviews.createReview({ prdRevisionId: prd.id, type: "agent" }));
    await runE(Reviews.startReview(review.id));

    await expect(runE(Prds.phaseAdvance(prd.id))).rejects.toThrow(
      /review .* is still 'in_progress'/i,
    );
  });

  it("blocks phaseAdvance when a done review still has open findings", async () => {
    const project = await runE(Projects.createProject({ name: "e2e-phase-open-findings" }));
    const workspace = await createTestWorkspace(project.id, "/tmp/depot-e2e-phase-open-findings");

    const { prd, tasks } = await runE(
      Prds.loadPrdBatch({
        projectId: project.id,
        title: "Open Findings Block PRD",
        ready: true,
        tasks: [
          {
            title: "Phase 1 task",
            description: "Implement phase 1",
            doneCriteria: "Phase 1 implemented",
            effort: "s",
            dependsOn: [],
            phaseNumber: 1,
          },
          {
            title: "Phase 2 task",
            description: "Implement phase 2",
            doneCriteria: "Phase 2 implemented",
            effort: "s",
            dependsOn: [],
            phaseNumber: 2,
          },
        ],
      }),
    );

    await runE(Prds.activatePrd(prd.id, workspace.id));
    await runE(Tasks.startTask(tasks[0]!.id));
    await runE(Tasks.completeTask(tasks[0]!.id));

    const review = await runE(Reviews.createReview({ prdRevisionId: prd.id, type: "human" }));
    await runE(Reviews.startReview(review.id));
    const finding = await runE(
      Reviews.addReviewTask(review.id, {
        title: "Fix regression",
        description: "Address the review finding",
        doneCriteria: "Regression is fixed",
      }),
    );
    await runE(Reviews.doneReview(review.id));

    await expect(runE(Prds.phaseAdvance(prd.id))).rejects.toThrow(
      new RegExp(
        `review task 'Fix regression' \\(${finding.id}\\) in review ${review.id} is still 'pending'`,
        "i",
      ),
    );
  });

  it("blocks phaseAdvance when the current phase still has unfinished PRD tasks", async () => {
    const project = await runE(Projects.createProject({ name: "e2e-phase-open-task" }));
    const workspace = await createTestWorkspace(project.id, "/tmp/depot-e2e-phase-open-task");

    const { prd } = await runE(
      Prds.loadPrdBatch({
        projectId: project.id,
        title: "Open Task Block PRD",
        ready: true,
        tasks: [
          {
            title: "Phase 1 task",
            description: "Implement phase 1",
            doneCriteria: "Phase 1 implemented",
            effort: "s",
            dependsOn: [],
            phaseNumber: 1,
          },
          {
            title: "Phase 2 task",
            description: "Implement phase 2",
            doneCriteria: "Phase 2 implemented",
            effort: "s",
            dependsOn: [],
            phaseNumber: 2,
          },
        ],
      }),
    );

    await runE(Prds.activatePrd(prd.id, workspace.id));

    await expect(runE(Prds.phaseAdvance(prd.id))).rejects.toThrow(
      /task 'Phase 1 task'.* is still 'pending'/i,
    );
  });

  it("rejects mixed phased and unphased PRD task plans", async () => {
    const project = await runE(Projects.createProject({ name: "e2e-phase-mixed-plan" }));

    await expect(
      runE(
        Prds.loadPrdBatch({
          projectId: project.id,
          title: "Mixed Phase PRD",
          ready: true,
          tasks: [
            {
              title: "Phase 1 task",
              description: "Implement phase 1",
              doneCriteria: "Phase 1 implemented",
              effort: "s",
              dependsOn: [],
              phaseNumber: 1,
            },
            {
              title: "Unphased task",
              description: "This task has no phase",
              doneCriteria: "Task completed",
              effort: "s",
              dependsOn: [],
            },
          ],
        }),
      ),
    ).rejects.toThrow(/has no phaseNumber while other tasks are phased/i);
  });

  it("rejects non-contiguous PRD task phase plans", async () => {
    const project = await runE(Projects.createProject({ name: "e2e-phase-gapped-plan" }));

    await expect(
      runE(
        Prds.loadPrdBatch({
          projectId: project.id,
          title: "Gapped Phase PRD",
          ready: true,
          tasks: [
            {
              title: "Phase 1 task",
              description: "Implement phase 1",
              doneCriteria: "Phase 1 implemented",
              effort: "s",
              dependsOn: [],
              phaseNumber: 1,
            },
            {
              title: "Phase 3 task",
              description: "Implement phase 3",
              doneCriteria: "Phase 3 implemented",
              effort: "s",
              dependsOn: [],
              phaseNumber: 3,
            },
          ],
        }),
      ),
    ).rejects.toThrow(/missing phase 2/i);
  });

  it("rejects invalid phase plans when reloading draft PRDs", async () => {
    const project = await runE(Projects.createProject({ name: "e2e-phase-reload-invalid" }));
    const { prd } = await runE(
      Prds.loadPrdBatch({
        projectId: project.id,
        title: "Draft Reload PRD",
        tasks: [
          {
            title: "Initial task",
            description: "Draft task",
            doneCriteria: "Draft task complete",
            effort: "s",
            dependsOn: [],
          },
        ],
      }),
    );

    await expect(
      runE(
        Prds.reloadPrdBatch({
          prdRevisionId: prd.id,
          title: "Draft Reload PRD",
          tasks: [
            {
              title: "Phase 1 task",
              description: "Implement phase 1",
              doneCriteria: "Phase 1 implemented",
              effort: "s",
              dependsOn: [],
              phaseNumber: 1,
            },
            {
              title: "Phase 3 task",
              description: "Implement phase 3",
              doneCriteria: "Phase 3 implemented",
              effort: "s",
              dependsOn: [],
              phaseNumber: 3,
            },
          ],
        }),
      ),
    ).rejects.toThrow(/missing phase 2/i);
  });

  it("advances phases and closes the PRD after the last phase when reviews and tasks are complete", async () => {
    const project = await runE(Projects.createProject({ name: "e2e-phase-advance-happy" }));
    const workspace = await createTestWorkspace(project.id, "/tmp/depot-e2e-phase-advance-happy");

    const { prd, tasks } = await runE(
      Prds.loadPrdBatch({
        projectId: project.id,
        title: "Phase Advance Happy Path PRD",
        ready: true,
        tasks: [
          {
            title: "Phase 1 task",
            description: "Implement phase 1",
            doneCriteria: "Phase 1 implemented",
            effort: "s",
            dependsOn: [],
            phaseNumber: 1,
          },
          {
            title: "Phase 2 task",
            description: "Implement phase 2",
            doneCriteria: "Phase 2 implemented",
            effort: "s",
            dependsOn: [],
            phaseNumber: 2,
          },
        ],
      }),
    );

    await runE(Prds.activatePrd(prd.id, workspace.id));

    await runE(Tasks.startTask(tasks[0]!.id));
    await runE(Tasks.completeTask(tasks[0]!.id));

    const phase1Review = await runE(Reviews.createReview({ prdRevisionId: prd.id, type: "agent" }));
    await runE(Reviews.startReview(phase1Review.id));
    const phase1Finding = await runE(
      Reviews.addReviewTask(phase1Review.id, {
        title: "Tighten implementation",
        description: "Apply the review feedback",
        doneCriteria: "Implementation is tightened",
      }),
    );
    await runE(Tasks.startTask(phase1Finding.id));
    await runE(Tasks.completeTask(phase1Finding.id));
    await runE(Reviews.doneReview(phase1Review.id));

    const advanced = await runE(Prds.phaseAdvance(prd.id));
    expect(advanced.advanced).toBe(true);
    expect(advanced.prd.currentPhase).toBe(2);
    expect(advanced.prd.status).toBe("in_progress");

    const phase2Task = tasks[1]!;
    await runE(Tasks.startTask(phase2Task.id));
    await runE(Tasks.completeTask(phase2Task.id));

    const phase2Review = await runE(Reviews.createReview({ prdRevisionId: prd.id, type: "human" }));
    const donePhase2Review = await runE(Reviews.doneReview(phase2Review.id));
    expect(donePhase2Review.status).toBe("done");
    expect(donePhase2Review.phaseNumber).toBe(2);

    const closed = await runE(Prds.phaseAdvance(prd.id));
    expect(closed.advanced).toBe(false);
    expect(closed.prd.status).toBe("done");

    const persistedPrd = await runE(Prds.getPrd(prd.id));
    expect(persistedPrd?.status).toBe("done");

    const activity = await runE(Activity.listActivityForRevision(prd.id));
    expect(activity.filter((entry) => entry.eventType === "phase_advanced")).toHaveLength(2);
    expect(activity.some((entry) => entry.eventType === "prd_done")).toBe(true);
  });

  it("covers load to manual completion", async () => {
    const project = await runE(Projects.createProject({ name: "e2e-prd-lifecycle" }));
    const workspace = await createTestWorkspace(project.id, "/tmp/depot-e2e-lifecycle");

    const { prd, tasks } = await runE(
      Prds.loadPrdBatch({
        projectId: project.id,
        title: "Lifecycle PRD",
        ready: true,
        tasks: [
          {
            title: "Task 1",
            description: "Desc 1",
            doneCriteria: "Done 1",
            effort: "s",
            dependsOn: [],
          },
          {
            title: "Task 2",
            description: "Desc 2",
            doneCriteria: "Done 2",
            effort: "s",
            dependsOn: [],
          },
        ],
      }),
    );

    expect(prd.status).toBe("ready");
    expect(tasks).toHaveLength(2);

    const activePrd = await runE(Prds.activatePrd(prd.id, workspace.id));
    expect(activePrd.status).toBe("in_progress");

    const startedTask1 = await runE(Tasks.startTask(tasks[0]!.id));
    expect(startedTask1.status).toBe("in_progress");
    const doneTask1 = await runE(Tasks.completeTask(tasks[0]!.id));
    expect(doneTask1.status).toBe("done");

    const startedTask2 = await runE(Tasks.startTask(tasks[1]!.id));
    expect(startedTask2.status).toBe("in_progress");
    const doneTask2 = await runE(Tasks.completeTask(tasks[1]!.id));
    expect(doneTask2.status).toBe("done");

    const donePrd = await runE(Prds.donePrd(prd.id));
    expect(donePrd.status).toBe("done");

    const persistedPrd = await runE(Prds.getPrd(prd.id));
    expect(persistedPrd?.status).toBe("done");

    const persistedTasks = await getTestDb().query.tasks.findMany({
      where: { prdRevisionId: prd.id },
      orderBy: { position: "asc" },
    });
    expect(persistedTasks.map((task) => task.status)).toEqual(["done", "done"]);
  });
});
