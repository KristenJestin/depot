import { Schema } from "effect";
import { command } from "#/cli/command";
import { runEffect } from "#/cli/runtime";
import type { TaskRow } from "#/db/schema";
import * as DomainTasks from "#/modules/tasks/domain";
import * as DomainPrds from "#/modules/prds/domain";
import { effortSchema } from "#/shared/schemas";
import { getTaskDescriptionSections } from "#/modules/tasks/spec";
import { formatDate } from "#/shared/utils";
import type { CommandOutput } from "#/cli/command";

const TASK_SHOW_LABEL_WIDTH = 11;

// ── Helpers ───────────────────────────────────────────────────────────────────

function serializeTask(task: TaskRow) {
  return {
    ...task,
    dependsOn: JSON.parse(task.dependsOn) as string[],
  };
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
      required: true,
      description: "Task description",
    },
    criteria: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      description: "Done criteria (textual)",
    },
    effort: {
      schema: effortSchema,
      required: true,
      alias: "e",
      description: "Effort estimate (xs/s/m/l/xl)",
    },
    depends: {
      schema: Schema.String,
      description: "Comma-separated list of dependency task IDs",
    },
  },
  run: async ({ args, output }) => {
    const prd = await runEffect(DomainPrds.getPrd(args.prdId));
    if (!prd) return output.error("not_found", `PRD not found: ${args.prdId}`);

    let dependencyIds: string[] | undefined = undefined;
    if (args.depends) {
      dependencyIds = [];
      for (const rawId of args.depends.split(",")) {
        const dep = await runEffect(DomainTasks.getTask(rawId.trim()));
        if (!dep) return output.error("not_found", `Task not found: ${rawId.trim()}`);
        dependencyIds.push(dep.id);
      }
    }

    const task = await runEffect(
      DomainTasks.createTask({
        prdId: prd.id,
        title: args.title,
        description: args.desc,
        doneCriteria: args.criteria,
        effort: args.effort,
        dependsOn: dependencyIds,
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
  },
  run: async ({ args, ws, output }) => {
    let targetPrdId = args.prdId;

    if (!targetPrdId) {
      // Default to the active PRD in this workspace
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
      if (!prd) return output.error("not_found", `PRD not found: ${targetPrdId}`);
      targetPrdId = prd.id;
    }

    const taskList = await runEffect(DomainTasks.listTasks(targetPrdId));
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
      output.print(`${t.id}  #${t.position}  ${t.title}  [${t.status}]  ${t.effort}${depStr}`);
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
  run: async ({ args, output }) => {
    const task = await runEffect(DomainTasks.getTask(args.taskId));
    if (!task) return output.error("not_found", `Task not found: ${args.taskId}`);
    if (output.isJson()) {
      output.success({ item: serializeTask(task) });
      return;
    }
    const deps: string[] = JSON.parse(task.dependsOn);
    output.fields([
      ["ID", task.id],
      ["Title", task.title],
      ["Status", task.status],
      ["Position", task.position],
      ["Effort", task.effort],
      ["Format", task.descriptionFormat],
      ["Depends On", deps.length > 0 ? deps.join(", ") : null],
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
      description: "New task description",
    },
    criteria: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      description: "New done criteria",
    },
    effort: {
      schema: effortSchema,
      alias: "e",
      description: "New effort estimate (xs/s/m/l/xl)",
    },
  },
  run: async ({ args, output }) => {
    const task = await runEffect(DomainTasks.getTask(args.taskId));
    if (!task) return output.error("not_found", `Task not found: ${args.taskId}`);

    if (
      args.title === undefined &&
      args.desc === undefined &&
      args.criteria === undefined &&
      args.effort === undefined
    ) {
      return output.error(
        "no_changes",
        "No changes provided. Use --title, --desc, --criteria, or --effort.",
      );
    }

    const updated = await runEffect(
      DomainTasks.updateTask(task.id, {
        title: args.title,
        description: args.desc,
        doneCriteria: args.criteria,
        effort: args.effort,
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
  run: async ({ args, output }) => {
    const task = await runEffect(DomainTasks.getTask(args.taskId));
    if (!task) return output.error("not_found", `Task not found: ${args.taskId}`);
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
  run: async ({ args, output }) => {
    const task = await runEffect(DomainTasks.getTask(args.taskId));
    if (!task) return output.error("not_found", `Task not found: ${args.taskId}`);
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
  run: async ({ args, output }) => {
    const task = await runEffect(DomainTasks.getTask(args.taskId));
    if (!task) return output.error("not_found", `Task not found: ${args.taskId}`);
    const blocked = await runEffect(DomainTasks.blockTask(task.id, args.reason));
    if (output.isJson()) {
      output.success({ item: serializeTask(blocked) });
    } else {
      output.print(`Blocked task '${blocked.title}' (${blocked.id}): ${args.reason}`);
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
  run: async ({ args, output }) => {
    const task = await runEffect(DomainTasks.getTask(args.taskId));
    if (!task) return output.error("not_found", `Task not found: ${args.taskId}`);
    const skipped = await runEffect(DomainTasks.skipTask(task.id, args.reason));
    if (output.isJson()) {
      output.success({ item: serializeTask(skipped) });
    } else {
      output.print(`Skipped task '${skipped.title}' (${skipped.id}): ${args.reason}`);
    }
  },
});

export const taskCommand = command({
  meta: { name: "task", description: "Task management" },
  subCommands: {
    add: addCommand,
    list: listCommand,
    show: showCommand,
    update: updateCommand,
    start: startCommand,
    done: doneCommand,
    block: blockCommand,
    skip: skipCommand,
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
  return style === "list" ? `- ${line}` : line;
}
