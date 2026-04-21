import { defineValidatedCommand } from "#/cli/command";
import { resolveCurrentWorkspace } from "#/cli/runtime";
import {
  createTask,
  listTasks,
  startTask,
  completeTask,
  blockTask,
  skipTask,
  listPrds,
  getTask,
  getPrd,
} from "#/lib/workflow";
import { effortSchema, commaSeparatedIds } from "#/lib/schemas";
import { log } from "#/lib/logger";
import {
  detectTaskDescriptionFormat,
  getTaskDescriptionSections,
} from "#/lib/task-spec";
import * as z from "zod";

const TASK_SHOW_LABEL_WIDTH = 11;

// ── Validation schema ─────────────────────────────────────────────────────────

const addTaskSchema = z.object({
  prd: z.string().min(1),
  title: z.string().min(1),
  desc: z.string().min(1),
  criteria: z.string().min(1),
  effort: effortSchema,
  depends: commaSeparatedIds,
});

const listTaskSchema = z.object({
  prdId: z.string().min(1).optional(),
});

const taskIdSchema = z.object({
  taskId: z.string().min(1),
});

const taskReasonSchema = z.object({
  taskId: z.string().min(1),
  reason: z.string().min(1),
});

// ── Commands ──────────────────────────────────────────────────────────────────

const addCommand = defineValidatedCommand({
  schema: addTaskSchema,
  meta: { name: "add", description: "Add a new task to a PRD" },
  args: {
    prd: {
      type: "string",
      description: "PRD ID",
      required: true,
    },
    title: {
      type: "string",
      alias: "t",
      description: "Task title",
      required: true,
    },
    desc: {
      type: "string",
      description: "Task description",
      required: true,
    },
    criteria: {
      type: "string",
      description: "Done criteria (textual)",
      required: true,
    },
    effort: {
      type: "string",
      alias: "e",
      description: "Effort estimate (xs/s/m/l/xl)",
      required: true,
    },
    depends: {
      type: "string",
      description: "Comma-separated list of dependency task IDs",
    },
  },
  run: async ({ args }) => {
    const { db } = await resolveCurrentWorkspace();
    const prd = await getPrd(db, args.prd);
    if (!prd) {
      console.error(`PRD not found: ${args.prd}`);
      process.exit(1);
    }

    const dependencyIds = args.depends
      ? await Promise.all(
          args.depends.map(async (taskId) => {
            const dependency = await getTask(db, taskId);
            if (!dependency) {
              console.error(`Task not found: ${taskId}`);
              process.exit(1);
            }
            return dependency.id;
          }),
        )
      : undefined;

    if (detectTaskDescriptionFormat(args.desc) !== "structured_v1") {
      console.error(
        "New tasks must use a structured description with Intent, Scope, and Non-goals sections.",
      );
      process.exit(1);
    }

    const task = await createTask(db, {
      prdId: prd.id,
      title: args.title,
      description: args.desc,
      descriptionFormat: "structured_v1",
      doneCriteria: args.criteria,
      effort: args.effort,
      dependsOn: dependencyIds,
    });
    console.log(`Created task '${task.title}' (${task.id}) [pending] pos=${task.position}`);
  },
});

const listCommand = defineValidatedCommand({
  schema: listTaskSchema,
  meta: { name: "list", description: "List tasks for a PRD" },
  args: {
    prdId: {
      type: "positional",
      description: "PRD ID (defaults to active PRD in current workspace)",
      required: false,
    },
  },
  run: async ({ args }) => {
    const { db, ws } = await resolveCurrentWorkspace();
    let targetPrdId = args.prdId;

    if (!targetPrdId) {
      // Default to the active PRD in this workspace
      const prdList = await listPrds(db, { workspaceId: ws.id });
      const activePrd = prdList.find((p) => p.status === "in_progress");
      if (!activePrd) {
        console.error("No active PRD found for current workspace. Specify a PRD ID.");
        process.exit(1);
      }
      targetPrdId = activePrd.id;
    } else {
      const prd = await getPrd(db, targetPrdId);
      if (!prd) {
        console.error(`PRD not found: ${targetPrdId}`);
        process.exit(1);
      }
      targetPrdId = prd.id;
    }

    const taskList = await listTasks(db, targetPrdId);
    if (taskList.length === 0) {
      console.log("No tasks found.");
      return;
    }
    for (const t of taskList) {
      const deps: string[] = JSON.parse(t.dependsOn);
      const depStr = deps.length > 0 ? ` deps=[${deps.join(",")}]` : "";
      console.log(`${t.id}  #${t.position}  ${t.title}  [${t.status}]  ${t.effort}${depStr}`);
    }
  },
});

const showCommand = defineValidatedCommand({
  schema: taskIdSchema,
  meta: { name: "show", description: "Show task details" },
  args: {
    taskId: {
      type: "positional",
      description: "Task ID",
      required: true,
    },
  },
  run: async ({ args }) => {
    const { db } = await resolveCurrentWorkspace();
    const task = await getTask(db, args.taskId);
    if (!task) {
      console.error(`Task not found: ${args.taskId}`);
      process.exit(1);
    }
    const deps: string[] = JSON.parse(task.dependsOn);
    log.fields([
      ["ID", task.id],
      ["Title", task.title],
      ["Status", task.status],
      ["Position", task.position],
      ["Effort", task.effort],
      ["Format", task.descriptionFormat],
      ["Depends On", deps.length > 0 ? deps.join(", ") : null],
      ["Blocked", task.blockedReason],
      ["Skipped", task.skipReason],
      ["Created", task.createdAt],
      ["Started", task.startedAt],
      ["Completed", task.completedAt],
    ]);

    for (const section of getTaskDescriptionSections(task.description, task.descriptionFormat)) {
      printTaskSection(section.label, section.lines, section.style);
    }

    printTaskSection(
      "Criteria",
      task.doneCriteria
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
      "list",
    );
  },
});

const startCommand = defineValidatedCommand({
  schema: taskIdSchema,
  meta: { name: "start", description: "Start a pending task" },
  args: {
    taskId: {
      type: "positional",
      description: "Task ID",
      required: true,
    },
  },
  run: async ({ args }) => {
    const { db } = await resolveCurrentWorkspace();
    const task = await getTask(db, args.taskId);
    if (!task) {
      console.error(`Task not found: ${args.taskId}`);
      process.exit(1);
    }
    const started = await startTask(db, task.id);
    console.log(`Started task '${started.title}' (${started.id})`);
  },
});

const doneCommand = defineValidatedCommand({
  schema: taskIdSchema,
  meta: {
    name: "done",
    description: "Mark an in_progress task as done",
  },
  args: {
    taskId: {
      type: "positional",
      description: "Task ID",
      required: true,
    },
  },
  run: async ({ args }) => {
    const { db } = await resolveCurrentWorkspace();
    const task = await getTask(db, args.taskId);
    if (!task) {
      console.error(`Task not found: ${args.taskId}`);
      process.exit(1);
    }
    const completed = await completeTask(db, task.id);
    console.log(`Completed task '${completed.title}' (${completed.id})`);
  },
});

const blockCommand = defineValidatedCommand({
  schema: taskReasonSchema,
  meta: {
    name: "block",
    description: "Block an in_progress task with a reason",
  },
  args: {
    taskId: {
      type: "positional",
      description: "Task ID",
      required: true,
    },
    reason: {
      type: "positional",
      description: "Block reason",
      required: true,
    },
  },
  run: async ({ args }) => {
    const { db } = await resolveCurrentWorkspace();
    const task = await getTask(db, args.taskId);
    if (!task) {
      console.error(`Task not found: ${args.taskId}`);
      process.exit(1);
    }
    const blocked = await blockTask(db, task.id, args.reason);
    console.log(`Blocked task '${blocked.title}' (${blocked.id}): ${args.reason}`);
  },
});

const skipCommand = defineValidatedCommand({
  schema: taskReasonSchema,
  meta: {
    name: "skip",
    description: "Skip a pending or blocked task with a reason",
  },
  args: {
    taskId: {
      type: "positional",
      description: "Task ID",
      required: true,
    },
    reason: {
      type: "positional",
      description: "Skip reason",
      required: true,
    },
  },
  run: async ({ args }) => {
    const { db } = await resolveCurrentWorkspace();
    const task = await getTask(db, args.taskId);
    if (!task) {
      console.error(`Task not found: ${args.taskId}`);
      process.exit(1);
    }
    const skipped = await skipTask(db, task.id, args.reason);
    console.log(`Skipped task '${skipped.title}' (${skipped.id}): ${args.reason}`);
  },
});

export const taskCommand = defineValidatedCommand({
  schema: z.object({}),
  meta: { name: "task", description: "Task management" },
  subCommands: {
    add: addCommand,
    list: listCommand,
    show: showCommand,
    start: startCommand,
    done: doneCommand,
    block: blockCommand,
    skip: skipCommand,
  },
});

function printTaskSection(
  label: string,
  lines: string[],
  style: "text" | "list",
): void {
  if (lines.length === 0) {
    return;
  }

  const prefix = `${label.padEnd(TASK_SHOW_LABEL_WIDTH)} : `;
  console.log(`${prefix}${formatSectionLine(lines[0]!, style)}`);

  const continuationPrefix = `${"".padEnd(TASK_SHOW_LABEL_WIDTH)}   `;
  for (const line of lines.slice(1)) {
    console.log(`${continuationPrefix}${formatSectionLine(line, style)}`);
  }
}

function formatSectionLine(line: string, style: "text" | "list"): string {
  return style === "list" ? `- ${line}` : line;
}
