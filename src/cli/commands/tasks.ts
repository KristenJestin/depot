import { Schema } from "effect";
import { command } from "#/cli/command";
import { resolveTextInput } from "#/cli/file-input";
import { runEffect } from "#/cli/runtime";
import type { TaskRow } from "#/db/schema";
import * as DomainTasks from "#/modules/tasks/domain";
import * as DomainPrds from "#/modules/prds/domain";
import * as DomainReviews from "#/modules/reviews/domain";
import * as DomainRepos from "#/modules/projects/repos";
import { effortSchema, taskKindSchema, triageStateSchema } from "#/shared/schemas";
import { VALID_TRIAGE_STATES } from "#/shared/validator";
import { getTaskDescriptionSections } from "#/modules/tasks/spec";
import { formatDate } from "#/shared/utils";
import type { CommandOutput } from "#/cli/command";
import { requireUserConfirmation, userConfirmedArg } from "#/cli/user-confirmation";

const TASK_SHOW_LABEL_WIDTH = 11;

// ── Helpers ───────────────────────────────────────────────────────────────────

function serializeTask(task: TaskRow) {
  return {
    ...task,
    dependsOn: JSON.parse(task.dependsOn) as string[],
  };
}

/**
 * Resolve a task identifier passed via the CLI.
 *
 * Accepted forms:
 *   - Full task ULID (returned as-is)
 *   - `#N` shorthand where N is the task position in the active PRD of the workspace
 *   - `#last` for the highest-position task in the active PRD
 *
 * For shorthand forms the workspace must have an active (in_progress) PRD.
 */
async function findTaskByRef(
  ref: string,
  ws: { id: string },
  output: CommandOutput,
): Promise<TaskRow> {
  const resolved = await resolveTaskId(ref, ws);
  if (!resolved.ok) return output.error("not_found", resolved.message);
  const task = await runEffect(DomainTasks.getTask(resolved.id));
  if (!task) return output.error("not_found", `Task not found: ${ref}`);
  return task;
}

async function resolveTaskId(
  ref: string,
  ws: { id: string },
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  if (!ref.startsWith("#")) return { ok: true, id: ref };
  const remainder = ref.slice(1).trim();
  const prdList = await runEffect(DomainPrds.listPrds({ workspaceId: ws.id }));
  const activePrd = prdList.find((p) => p.status === "in_progress");
  if (!activePrd) {
    return {
      ok: false,
      message: `Cannot resolve '${ref}': no active PRD in current workspace.`,
    };
  }
  const taskList = await runEffect(DomainTasks.listTasks(activePrd.id, { prdTasksOnly: true }));
  if (taskList.length === 0) {
    return { ok: false, message: `Cannot resolve '${ref}': active PRD has no tasks.` };
  }
  if (remainder.toLowerCase() === "last") {
    return { ok: true, id: taskList[taskList.length - 1]!.id };
  }
  const n = Number.parseInt(remainder, 10);
  if (!Number.isFinite(n) || `${n}` !== remainder || n <= 0) {
    return {
      ok: false,
      message: `Cannot resolve '${ref}': expected '#<N>' or '#last' (got '${remainder}').`,
    };
  }
  const found = taskList.find((t) => t.position === n);
  if (!found) {
    return {
      ok: false,
      message: `Cannot resolve '${ref}': active PRD has no task at position ${n}.`,
    };
  }
  return { ok: true, id: found.id };
}

/**
 * Detect whether a CLI flag was passed more than once in the raw args.
 *
 * Citty resolves duplicate flags as "last wins" instead of erring, so for
 * single-value flags we have to scan `ctx.rawArgs` ourselves when we want
 * to refuse repetition outright. Used by `--repo` on tasks to enforce the
 * 0..1 cardinality (a single repo per task).
 */
function flagRepeatedInRaw(rawArgs: readonly string[] | undefined, flag: string): boolean {
  if (!rawArgs) return false;
  let seen = 0;
  for (const raw of rawArgs) {
    if (raw === flag || raw.startsWith(`${flag}=`)) {
      seen += 1;
      if (seen > 1) return true;
    }
  }
  return false;
}

// ── Commands ──────────────────────────────────────────────────────────────────

const addCommand = command({
  meta: { name: "add", description: "Add a new task to a PRD" },
  workspace: true,
  args: {
    prdId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      description: "PRD ID",
    },
    title: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      alias: "t",
      description: "Task title",
    },
    desc: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      expected: "non-empty text",
      description: "Task description; new tasks store descriptions as structured_v1",
    },
    descFile: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      expected: "path to a readable text file",
      description: "Read structured_v1 task description from a UTF-8 text file",
    },
    criteria: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      expected: "non-empty text",
      description: "Done criteria (textual)",
    },
    criteriaFile: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      expected: "path to a readable text file",
      description: "Read done criteria from a UTF-8 text file",
    },
    effort: {
      schema: effortSchema,
      required: true,
      alias: "e",
      expected: "one of xs, s, m, l, xl",
      description: "Effort estimate (xs/s/m/l/xl)",
    },
    kind: {
      schema: taskKindSchema,
      expected: "one of slice, gate, support, human",
      description: "Task kind (slice/gate/support/human)",
    },
    verification: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      expected: "a non-empty shell command",
      description:
        "Optional shell command run by 'task verify' to confirm a human task is done (only valid with --kind human)",
    },
    depends: {
      schema: Schema.String,
      description: "Comma-separated list of dependency task IDs",
    },
    phase: {
      schema: Schema.Int.pipe(Schema.positive()),
      coerce: "integer",
      expected: "a positive integer",
      alias: "p",
      description: "Phase number this task belongs to (multi-phase PRDs only)",
    },
    repo: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      expected: "a single repo name (from the PRD's repo scope)",
      description: "Attach the task to a project_repo by name (must be in the PRD's repo scope)",
    },
  },
  run: async ({ args, rawArgs, output }) => {
    if (flagRepeatedInRaw(rawArgs, "--repo")) {
      return output.error(
        "conflicting_input",
        "A task can be attached to at most one repo. Pass --repo only once; for a cross-repo change, split into separate tasks and link them with --depends.",
      );
    }
    if (args.verification !== undefined && args.kind !== "human") {
      return output.error(
        "conflicting_input",
        "--verification is only valid with --kind human. Drop --verification or set --kind human.",
      );
    }
    const description = await resolveTextInput({
      output,
      value: args.desc,
      file: args.descFile,
      valueFlag: "--desc",
      fileFlag: "--desc-file",
      required: true,
    });
    const doneCriteria = await resolveTextInput({
      output,
      value: args.criteria,
      file: args.criteriaFile,
      valueFlag: "--criteria",
      fileFlag: "--criteria-file",
      required: true,
    });
    const prd = await runEffect(DomainPrds.getPrd(args.prdId));
    if (!prd) return output.error("not_found", `PRD not found: ${args.prdId}`);

    if (prd.status !== "draft") {
      const hint =
        prd.status === "ready"
          ? ` Run \`depot prd fork ${prd.id}\` to create a new draft revision first.`
          : " No task modifications are allowed on a PRD in this status.";
      return output.error(
        "prd_not_draft",
        `PRD '${prd.title}' is in status '${prd.status}'. Only draft PRDs accept new tasks.${hint}`,
      );
    }

    let dependencyIds: string[] | undefined = undefined;
    if (args.depends) {
      dependencyIds = [];
      for (const rawId of args.depends.split(",")) {
        const dep = await runEffect(DomainTasks.getTask(rawId.trim()));
        if (!dep) return output.error("not_found", `Task not found: ${rawId.trim()}`);
        dependencyIds.push(dep.id);
      }
    }

    let repoId: string | null | undefined = undefined;
    if (args.repo !== undefined) {
      const repo = await runEffect(DomainRepos.getRepo(prd.projectId, args.repo));
      if (!repo) {
        return output.error(
          "not_found",
          `Repo '${args.repo}' is not registered for project ${prd.projectId}.`,
        );
      }
      repoId = repo.id;
    }

    const task = await runEffect(
      DomainTasks.createTask({
        prdRevisionId: prd.id,
        title: args.title,
        description,
        doneCriteria,
        effort: args.effort,
        kind: args.kind,
        dependsOn: dependencyIds,
        phaseNumber: args.phase,
        repoId,
        verificationCommand: args.verification,
      }),
    );

    if (output.isJson()) {
      output.success({ item: serializeTask(task) });
    } else {
      output.print(`Created task '${task.title}' (${task.id}) [pending] pos=${task.position}`);
    }
  },
});

const listCommand = command({
  meta: { name: "list", description: "List tasks for a PRD" },
  workspace: true,
  args: {
    prdId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      positional: true,
      description: "PRD ID (defaults to active PRD in current workspace)",
    },
    status: {
      schema: Schema.String,
      expected: "comma-separated list of pending|in_progress|blocked|done|skipped",
      description: "Filter by task status (comma-separated)",
    },
    triage: {
      schema: Schema.String,
      expected: `comma-separated list of ${VALID_TRIAGE_STATES.join("|")}`,
      description: "Filter by triage state (comma-separated)",
    },
    allPhases: {
      schema: Schema.Boolean,
      type: "boolean",
      default: false,
      description: "Show tasks for all phases (default: current phase only when in_progress)",
    },
    hideSkipped: {
      schema: Schema.Boolean,
      type: "boolean",
      default: false,
      description: "Hide skipped tasks",
    },
  },
  run: async ({ args, ws, output }) => {
    let targetPrdId = args.prdId;

    if (!targetPrdId) {
      const prdList = await runEffect(DomainPrds.listPrds({ workspaceId: ws.id }));
      const activePrd = prdList.find((p) => p.status === "in_progress");
      if (!activePrd) {
        return output.error(
          "no_active_prd",
          "No active PRD found for current workspace. Specify a PRD ID.",
        );
      }
      targetPrdId = activePrd.id;
    } else {
      const prd = await runEffect(DomainPrds.getPrd(targetPrdId));
      if (!prd) {
        const review = await runEffect(DomainReviews.getReview(targetPrdId));
        if (review) {
          return output.error(
            "review_id_passed",
            `'${targetPrdId}' is a review ID, not a PRD ID. Use \`depot review task list ${targetPrdId}\` to list its tasks.`,
          );
        }
        return output.error("not_found", `PRD not found: ${targetPrdId}`);
      }
      targetPrdId = prd.id;
    }

    const prd = await runEffect(DomainPrds.getPrd(targetPrdId));
    if (!prd) return output.error("not_found", `PRD not found: ${targetPrdId}`);

    const phaseFilter =
      !args.allPhases &&
      prd.status === "in_progress" &&
      prd.currentPhase !== null &&
      prd.currentPhase !== undefined
        ? prd.currentPhase
        : undefined;

    let taskList = await runEffect(
      DomainTasks.listTasks(targetPrdId, { phase: phaseFilter, prdTasksOnly: true }),
    );

    if (args.status) {
      const wanted = new Set(
        args.status
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
      );
      const valid = new Set(["pending", "in_progress", "blocked", "done", "skipped"]);
      for (const s of wanted) {
        if (!valid.has(s)) {
          return output.error(
            "validation_error",
            `--status: '${s}' is not a valid task status. Expected pending, in_progress, blocked, done, or skipped.`,
          );
        }
      }
      taskList = taskList.filter((t) => wanted.has(t.status));
    }

    if (args.triage) {
      const wanted = new Set(
        args.triage
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
      );
      for (const s of wanted) {
        if (!(VALID_TRIAGE_STATES as readonly string[]).includes(s)) {
          return output.error(
            "validation_error",
            `--triage: '${s}' is not a valid triage state. Expected ${VALID_TRIAGE_STATES.join(", ")}.`,
          );
        }
      }
      taskList = taskList.filter((t) => wanted.has(t.triageState));
    }

    if (args.hideSkipped) {
      taskList = taskList.filter((t) => t.status !== "skipped");
    }

    // Surface `ready-for-agent` first so the coder picks up actionable tasks
    // before triage-parked ones (needs-info / ready-for-human / wontfix). The
    // dependency-order position is preserved within each triage bucket.
    taskList = sortReadyForAgentFirst(taskList);

    if (output.isJson()) {
      output.success({ items: taskList.map(serializeTask) });
      return;
    }
    if (taskList.length === 0) {
      output.print("No tasks found.");
      return;
    }
    for (const t of taskList) {
      const deps: string[] = JSON.parse(t.dependsOn);
      const depStr = deps.length > 0 ? ` deps=[${deps.join(",")}]` : "";
      output.print(
        `${t.id}  #${t.position}  ${t.title}  [${t.status}]  ${t.effort}  triage=${t.triageState}${depStr}`,
      );
    }
  },
});

/**
 * Stable-sort tasks so `ready-for-agent` (and the default `needs-triage` that
 * legacy rows carry) bubble to the top while every other triage bucket keeps
 * its dependency-order position. Used by `task list` to mirror what the coder
 * should pick up next: a `needs-info` / `ready-for-human` / `wontfix` task is
 * not "to take now".
 */
function sortReadyForAgentFirst(taskList: readonly TaskRow[]): TaskRow[] {
  const rank = (t: TaskRow): number => (t.triageState === "ready-for-agent" ? 0 : 1);
  return [...taskList]
    .map((task, index) => ({ task, index }))
    .sort((a, b) => rank(a.task) - rank(b.task) || a.index - b.index)
    .map((entry) => entry.task);
}

const treeCommand = command({
  meta: {
    name: "tree",
    description: "Print an ASCII dependency tree of PRD tasks",
  },
  workspace: true,
  args: {
    prdId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      positional: true,
      description: "PRD ID (defaults to active PRD in current workspace)",
    },
  },
  run: async ({ args, ws, output }) => {
    let targetPrdId = args.prdId;
    if (!targetPrdId) {
      const prdList = await runEffect(DomainPrds.listPrds({ workspaceId: ws.id }));
      const activePrd = prdList.find((p) => p.status === "in_progress");
      if (!activePrd) {
        return output.error(
          "no_active_prd",
          "No active PRD found for current workspace. Specify a PRD ID.",
        );
      }
      targetPrdId = activePrd.id;
    }

    const prd = await runEffect(DomainPrds.getPrd(targetPrdId));
    if (!prd) return output.error("not_found", `PRD not found: ${targetPrdId}`);

    const taskList = await runEffect(DomainTasks.listTasks(prd.id, { prdTasksOnly: true }));

    if (taskList.length === 0) {
      output.print("No tasks found.");
      return;
    }

    type Node = { id: string; pos: number; title: string; status: string; deps: string[] };
    const nodes = new Map<string, Node>();
    for (const t of taskList) {
      nodes.set(t.id, {
        id: t.id,
        pos: t.position,
        title: t.title,
        status: t.status,
        deps: JSON.parse(t.dependsOn) as string[],
      });
    }

    const childrenOf = new Map<string, string[]>();
    for (const n of nodes.values()) childrenOf.set(n.id, []);
    for (const n of nodes.values()) {
      for (const dep of n.deps) {
        if (childrenOf.has(dep)) childrenOf.get(dep)!.push(n.id);
      }
    }

    const roots = [...nodes.values()].filter((n) => n.deps.length === 0);

    if (output.isJson()) {
      output.success({
        prd: { id: prd.id, title: prd.title },
        nodes: [...nodes.values()],
        roots: roots.map((r) => r.id),
      });
      return;
    }

    const seen = new Set<string>();
    function render(id: string, prefix: string, isLast: boolean): void {
      const n = nodes.get(id);
      if (!n) return;
      const branch = prefix.length === 0 ? "" : isLast ? "└── " : "├── ";
      const marker = seen.has(id) ? " (↺)" : "";
      output.print(`${prefix}${branch}#${n.pos} ${n.title} [${n.status}]${marker}`);
      if (seen.has(id)) return;
      seen.add(id);
      const kids = (childrenOf.get(id) ?? []).slice().sort((a, b) => {
        const aPos = nodes.get(a)?.pos ?? 0;
        const bPos = nodes.get(b)?.pos ?? 0;
        return aPos - bPos;
      });
      const nextPrefix = prefix + (prefix.length === 0 ? "" : isLast ? "    " : "│   ");
      kids.forEach((kid, i) => render(kid, nextPrefix, i === kids.length - 1));
    }

    if (roots.length === 0) {
      output.print("No root tasks (every task depends on something — possible cycle).");
      return;
    }
    roots.sort((a, b) => a.pos - b.pos);
    roots.forEach((r, i) => render(r.id, "", i === roots.length - 1));

    const orphans = [...nodes.values()].filter((n) => !seen.has(n.id));
    if (orphans.length > 0) {
      output.print("");
      output.print("Tasks not reachable from any root (likely cycle members):");
      for (const o of orphans) {
        output.print(`  #${o.pos} ${o.title} [${o.status}]`);
      }
    }
  },
});

const showCommand = command({
  meta: { name: "show", description: "Show task details" },
  workspace: true,
  args: {
    taskId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Task ID",
    },
  },
  run: async ({ args, ws, output }) => {
    const task = await findTaskByRef(args.taskId, ws, output);
    if (output.isJson()) {
      output.success({ item: serializeTask(task) });
      return;
    }
    const deps: string[] = JSON.parse(task.dependsOn);
    output.fields([
      ["ID", task.id],
      ["Title", task.title],
      ["Status", task.status],
      ["Triage", task.triageState],
      ["Position", task.position],
      ["Effort", task.effort],
      ["Kind", task.kind],
      ["Format", task.descriptionFormat],
      ["Depends On", deps.length > 0 ? deps.join(", ") : null],
      ["Verification", task.verificationCommand],
      ["Blocked", task.blockedReason],
      ["Skipped", task.skipReason],
      ["Created", formatDate(task.createdAt)],
      ["Started", formatDate(task.startedAt)],
      ["Completed", formatDate(task.completedAt)],
    ]);

    for (const section of getTaskDescriptionSections(task.description, task.descriptionFormat)) {
      printTaskSection(output, section.label, section.lines, section.style);
    }

    printTaskSection(
      output,
      "Criteria",
      task.doneCriteria
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
      "list",
    );
  },
});

const updateCommand = command({
  meta: { name: "update", description: "Update task fields in place" },
  workspace: true,
  args: {
    taskId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Task ID",
    },
    title: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      alias: "t",
      description: "New task title",
    },
    desc: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      expected: "non-empty text",
      description: "New task description; updates store descriptions as structured_v1",
    },
    descFile: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      expected: "path to a readable text file",
      description: "Read new structured_v1 task description from a UTF-8 text file",
    },
    criteria: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      expected: "non-empty text",
      description: "New done criteria",
    },
    criteriaFile: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      expected: "path to a readable text file",
      description: "Read new done criteria from a UTF-8 text file",
    },
    effort: {
      schema: effortSchema,
      alias: "e",
      expected: "one of xs, s, m, l, xl",
      description: "New effort estimate (xs/s/m/l/xl)",
    },
    kind: {
      schema: taskKindSchema,
      expected: "one of slice, gate, support",
      description: "New task kind (slice/gate/support)",
    },
    phase: {
      schema: Schema.Int.pipe(Schema.positive()),
      coerce: "integer",
      expected: "a positive integer",
      alias: "p",
      description: "New phase number (multi-phase PRDs only)",
    },
    depends: {
      schema: Schema.String,
      description: "Comma-separated list of dependency task IDs (replaces existing)",
    },
    addDepends: {
      schema: Schema.String,
      description: "Comma-separated list of dependency task IDs to add",
    },
    removeDepends: {
      schema: Schema.String,
      description: "Comma-separated list of dependency task IDs to remove",
    },
    severity: {
      schema: Schema.Literal("critical", "major", "minor", "info"),
      expected: "one of critical, major, minor, info",
      description: "Finding severity (review tasks only)",
    },
    repo: {
      // Citty turns `--no-repo` into `repo = false` (boolean negation of the
      // flag). We accept either: a string (set the attachment by repo name) or
      // `false` (clear the attachment, i.e. `--no-repo`). A repeat `--repo X
      // --repo Y` would surface as an array and fail validation cleanly.
      schema: Schema.Union(Schema.String.pipe(Schema.minLength(1)), Schema.Literal(false)),
      expected: "a single repo name (or --no-repo to clear)",
      description:
        "Attach the task to a project_repo by name (must be in the PRD's repo scope). Use --no-repo to clear.",
    },
  },
  run: async ({ args, rawArgs, ws, output }) => {
    if (flagRepeatedInRaw(rawArgs, "--repo")) {
      return output.error(
        "conflicting_input",
        "A task can be attached to at most one repo. Pass --repo only once; for a cross-repo change, split into separate tasks and link them with --depends.",
      );
    }
    const task = await findTaskByRef(args.taskId, ws, output);

    // Only PRD tasks (not review tasks) are subject to the draft-only guard
    if (!task.reviewId) {
      const prd = await runEffect(DomainPrds.getPrd(task.prdRevisionId));
      if (!prd) return output.error("not_found", `PRD not found: ${task.prdRevisionId}`);
      if (prd.status !== "draft") {
        const hint =
          prd.status === "ready"
            ? ` Run \`depot prd fork ${prd.id}\` to create a new draft revision first.`
            : " No task modifications are allowed on a PRD in this status.";
        return output.error(
          "prd_not_draft",
          `PRD '${prd.title}' is in status '${prd.status}'. Only draft PRDs allow task updates.${hint}`,
        );
      }
    }

    if (
      args.title === undefined &&
      args.desc === undefined &&
      args.descFile === undefined &&
      args.criteria === undefined &&
      args.criteriaFile === undefined &&
      args.effort === undefined &&
      args.kind === undefined &&
      args.phase === undefined &&
      args.depends === undefined &&
      args.addDepends === undefined &&
      args.removeDepends === undefined &&
      args.severity === undefined &&
      args.repo === undefined
    ) {
      return output.error(
        "no_changes",
        "No changes provided. Use --title, --desc, --desc-file, --criteria, --criteria-file, --effort, --kind, --phase, --depends, --add-depends, --remove-depends, --severity, --repo, or --no-repo.",
      );
    }

    if (
      args.depends !== undefined &&
      (args.addDepends !== undefined || args.removeDepends !== undefined)
    ) {
      return output.error(
        "conflicting_input",
        "Use either --depends (replace) or --add-depends / --remove-depends (incremental), not both.",
      );
    }

    const splitIds = (raw: string | undefined): string[] | undefined => {
      if (raw === undefined) return undefined;
      return raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    };

    const description = await resolveTextInput({
      output,
      value: args.desc,
      file: args.descFile,
      valueFlag: "--desc",
      fileFlag: "--desc-file",
    });
    const doneCriteria = await resolveTextInput({
      output,
      value: args.criteria,
      file: args.criteriaFile,
      valueFlag: "--criteria",
      fileFlag: "--criteria-file",
    });

    let repoId: string | null | undefined = undefined;
    if (args.repo === false) {
      repoId = null;
    } else if (typeof args.repo === "string") {
      const prd = await runEffect(DomainPrds.getPrd(task.prdRevisionId));
      if (!prd) return output.error("not_found", `PRD not found: ${task.prdRevisionId}`);
      const repo = await runEffect(DomainRepos.getRepo(prd.projectId, args.repo));
      if (!repo) {
        return output.error(
          "not_found",
          `Repo '${args.repo}' is not registered for project ${prd.projectId}.`,
        );
      }
      repoId = repo.id;
    }

    const updated = await runEffect(
      DomainTasks.updateTask(task.id, {
        title: args.title,
        description,
        doneCriteria,
        effort: args.effort,
        kind: args.kind,
        phaseNumber: args.phase,
        dependsOn: splitIds(args.depends),
        addDependsOn: splitIds(args.addDepends),
        removeDependsOn: splitIds(args.removeDepends),
        severity: args.severity,
        repoId,
      }),
    );

    if (output.isJson()) {
      output.success({ item: serializeTask(updated) });
    } else {
      output.print(`Updated task '${updated.title}' (${updated.id}) [${updated.status}]`);
    }
  },
});

const startCommand = command({
  meta: { name: "start", description: "Start a pending task" },
  workspace: true,
  args: {
    taskId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Task ID",
    },
  },
  run: async ({ args, ws, output }) => {
    const task = await findTaskByRef(args.taskId, ws, output);
    const started = await runEffect(DomainTasks.startTask(task.id));
    if (output.isJson()) {
      output.success({ item: serializeTask(started) });
    } else {
      output.print(`Started task '${started.title}' (${started.id})`);
    }
  },
});

const doneCommand = command({
  meta: {
    name: "done",
    description: "Mark an in_progress task as done",
  },
  workspace: true,
  args: {
    taskId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Task ID",
    },
  },
  run: async ({ args, ws, output }) => {
    const task = await findTaskByRef(args.taskId, ws, output);
    const completed = await runEffect(DomainTasks.completeTask(task.id));
    if (output.isJson()) {
      output.success({ item: serializeTask(completed) });
    } else {
      output.print(`Completed task '${completed.title}' (${completed.id})`);
    }
  },
});

const blockCommand = command({
  meta: {
    name: "block",
    description: "Block an in_progress task with a reason",
  },
  workspace: true,
  args: {
    taskId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Task ID",
    },
    reason: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Block reason",
    },
  },
  run: async ({ args, ws, output }) => {
    const task = await findTaskByRef(args.taskId, ws, output);
    const blocked = await runEffect(DomainTasks.blockTask(task.id, args.reason));
    if (output.isJson()) {
      output.success({ item: serializeTask(blocked) });
    } else {
      printTaskTransition(output, "Blocked", blocked, args.reason);
    }
  },
});

const skipCommand = command({
  meta: {
    name: "skip",
    description: "Skip a pending or blocked task with a reason",
  },
  workspace: true,
  args: {
    taskId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Task ID",
    },
    reason: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Skip reason",
    },
  },
  run: async ({ args, ws, output }) => {
    const task = await findTaskByRef(args.taskId, ws, output);
    const skipped = await runEffect(DomainTasks.skipTask(task.id, args.reason));
    if (output.isJson()) {
      output.success({ item: serializeTask(skipped) });
    } else {
      printTaskTransition(output, "Skipped", skipped, args.reason);
    }
  },
});

const deleteCommand = command({
  meta: {
    name: "delete",
    description:
      "Delete a pending task that has never been started (for cleanup of test/draft tasks)",
  },
  workspace: true,
  args: {
    taskId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Task ID",
    },
  },
  run: async ({ args, ws, output }) => {
    const task = await findTaskByRef(args.taskId, ws, output);
    if (task.status !== "pending") {
      return output.error(
        "invalid_status",
        `Cannot delete task '${task.title}' (status: '${task.status}'). Only pending tasks can be deleted; use \`task skip\` for tasks already in motion.`,
      );
    }
    if (task.startedAt) {
      return output.error(
        "invalid_status",
        `Cannot delete task '${task.title}': it has been started before. Use \`task skip\` instead to preserve audit trail.`,
      );
    }
    if (!task.reviewId) {
      const prd = await runEffect(DomainPrds.getPrd(task.prdRevisionId));
      if (prd && prd.status !== "draft") {
        return output.error(
          "prd_not_draft",
          `Cannot delete task: parent PRD '${prd.title}' is '${prd.status}' (only draft allows deletions).`,
        );
      }
    }
    await runEffect(DomainTasks.deleteTask(task.id));
    if (output.isJson()) {
      output.success({ deleted: { id: task.id } });
    } else {
      output.print(`Deleted task '${task.title}' (${task.id})`);
    }
  },
});

const reactivateCommand = command({
  meta: {
    name: "reactivate",
    description:
      "Reset a skipped task back to pending (use sparingly — preserves no audit of the previous skip reason)",
  },
  workspace: true,
  args: {
    taskId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Task ID",
    },
  },
  run: async ({ args, ws, output }) => {
    const task = await findTaskByRef(args.taskId, ws, output);
    if (task.status !== "skipped") {
      return output.error(
        "invalid_status",
        `Cannot reactivate task '${task.title}': status is '${task.status}', expected 'skipped'.`,
      );
    }
    const reactivated = await runEffect(DomainTasks.reactivateTask(task.id));
    if (output.isJson()) {
      output.success({ item: serializeTask(reactivated) });
    } else {
      output.print(`Reactivated task '${reactivated.title}' (${reactivated.id}) [pending]`);
    }
  },
});

const verifyCommand = command({
  meta: {
    name: "verify",
    description:
      "Verify a human task: optionally run its verification command, capture the user's confirmation quote (PRD 0018).",
  },
  workspace: true,
  args: {
    taskId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Task ID (full ULID or '#N'/'#last' shorthand)",
    },
    userConfirmed: userConfirmedArg,
  },
  run: async ({ args, ws, output }) => {
    const task = await findTaskByRef(args.taskId, ws, output);
    if (task.kind !== "human") {
      return output.error(
        "invalid_kind",
        `Cannot verify task '${task.title}': kind is '${task.kind}'. Only 'human' tasks support 'task verify'; use 'task done' for agent tasks.`,
      );
    }
    const userConfirmation = requireUserConfirmation(args, "depot task verify", output);

    const result = await runEffect(DomainTasks.verifyTask(task.id, { userConfirmation }));

    if (!result.verified) {
      const exitCode = result.exec?.exitCode ?? 1;
      const stderr = (result.exec?.stderr ?? "").trim();
      const hint = stderr.length > 0 ? `\nstderr:\n${stderr}` : "";
      return output.error(
        "verification_failed",
        `Verification command for task '${task.title}' (${task.id}) exited with code ${exitCode}. Task stays 'pending'.${hint}`,
      );
    }

    if (output.isJson()) {
      output.success({
        item: serializeTask(result.task),
        verified: true,
        exec: result.exec,
      });
    } else {
      output.print(`Verified human task '${result.task.title}' (${result.task.id}) [done]`);
      if (result.exec) {
        output.print(`Verification command exited 0.`);
      }
    }
  },
});

const triageCommand = command({
  meta: {
    name: "triage",
    description: "Set the triage state on a PRD task (shortcut for the triage axis)",
  },
  workspace: true,
  args: {
    taskId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Task ID (full ULID or '#N'/'#last' shorthand)",
    },
    state: {
      schema: triageStateSchema,
      required: true,
      positional: true,
      expected: `one of ${VALID_TRIAGE_STATES.join(", ")}`,
      description: "Triage state",
    },
    reason: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      alias: "r",
      description: "Reason for the triage decision (recorded in the activity log)",
    },
  },
  run: async ({ args, ws, output }) => {
    const task = await findTaskByRef(args.taskId, ws, output);
    const updated = await runEffect(
      DomainTasks.triageTask(task.id, args.state, {
        reason: args.reason,
        source: "human",
      }),
    );
    if (output.isJson()) {
      output.success({ item: serializeTask(updated) });
    } else {
      output.print(
        `Triaged task '${updated.title}' (${updated.id}) → ${args.state}${args.reason ? ` (${args.reason})` : ""}`,
      );
    }
  },
});

export const taskCommand = command({
  meta: { name: "task", description: "Task management" },
  subCommands: {
    add: addCommand,
    list: listCommand,
    tree: treeCommand,
    show: showCommand,
    update: updateCommand,
    triage: triageCommand,
    start: startCommand,
    done: doneCommand,
    verify: verifyCommand,
    block: blockCommand,
    skip: skipCommand,
    delete: deleteCommand,
    reactivate: reactivateCommand,
  },
});

function printTaskSection(
  output: CommandOutput,
  label: string,
  lines: string[],
  style: "text" | "list",
): void {
  if (lines.length === 0) {
    return;
  }

  const prefix = `${label.padEnd(TASK_SHOW_LABEL_WIDTH)} : `;
  output.print(`${prefix}${formatSectionLine(lines[0]!, style)}`);

  const continuationPrefix = `${"".padEnd(TASK_SHOW_LABEL_WIDTH)}   `;
  for (const line of lines.slice(1)) {
    output.print(`${continuationPrefix}${formatSectionLine(line, style)}`);
  }
}

function formatSectionLine(line: string, style: "text" | "list"): string {
  return style === "list" ? `- ${stripListMarker(line)}` : line;
}

function stripListMarker(line: string): string {
  return line.replace(/^[-*]\s+/, "").trim();
}

function printTaskTransition(
  output: CommandOutput,
  verb: "Blocked" | "Skipped",
  task: TaskRow,
  reason: string,
): void {
  const normalizedReason = reason.trim();
  if (normalizedReason.length <= 100 && !normalizedReason.includes("\n")) {
    output.print(`${verb} task '${task.title}' (${task.id}): ${normalizedReason}`);
    return;
  }

  output.print(`${verb} task '${task.title}' (${task.id})`);
  output.print("Reason:");
  for (const line of normalizedReason.split("\n")) {
    output.print(`  ${line.trim()}`);
  }
}
