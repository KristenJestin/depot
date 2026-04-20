import { defineCommand } from "citty";
import { resolveCurrentWorkspace } from "#/cli/context";
import {
  createTask,
  listTasks,
  startTask,
  completeTask,
  blockTask,
  skipTask,
  listPrds,
  findTaskByPrefix,
  findPrdByPrefix,
} from "#/lib/workflow";
import { shortId } from "#/lib/ids";
import { effortSchema, commaSeparatedIds, validateArgs } from "#/lib/schemas";
import { log } from "#/lib/logger";
import * as z from "zod";

// ── Validation schema ─────────────────────────────────────────────────────────

const addTaskSchema = z.object({
  effort: effortSchema,
  depends: commaSeparatedIds,
});

// ── Commands ──────────────────────────────────────────────────────────────────

const addCommand = defineCommand({
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
    // Validate and narrow types in one step — no cast required
    const validated = validateArgs(addTaskSchema, { effort: args.effort, depends: args.depends });

    const { db } = await resolveCurrentWorkspace();
    const prd = await findPrdByPrefix(db, args.prd);
    if (!prd) {
      console.error(`PRD not found: ${args.prd}`);
      process.exit(1);
    }

    const dependencyIds = validated.depends
      ? await Promise.all(
          validated.depends.map(async (taskId) => {
            const dependency = await findTaskByPrefix(db, taskId);
            if (!dependency) {
              console.error(`Task not found: ${taskId}`);
              process.exit(1);
            }
            return dependency.id;
          }),
        )
      : undefined;

    const task = await createTask(db, {
      prdId: prd.id,
      title: args.title,
      description: args.desc,
      doneCriteria: args.criteria,
      effort: validated.effort,
      dependsOn: dependencyIds,
    });
    console.log(
      `Created task '${task.title}' (${shortId(task.id)}) [pending] pos=${task.position}`,
    );
  },
});

const listCommand = defineCommand({
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
      const prd = await findPrdByPrefix(db, targetPrdId);
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
      const depStr = deps.length > 0 ? ` deps=[${deps.map(shortId).join(",")}]` : "";
      console.log(
        `${shortId(t.id)}  #${t.position}  ${t.title}  [${t.status}]  ${t.effort}${depStr}`,
      );
    }
  },
});

const showCommand = defineCommand({
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
    const task = await findTaskByPrefix(db, args.taskId);
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
      ["Description", task.description],
      ["Criteria", task.doneCriteria],
      ["Depends On", deps.length > 0 ? deps.join(", ") : null],
      ["Blocked", task.blockedReason],
      ["Skipped", task.skipReason],
      ["Created", task.createdAt],
      ["Started", task.startedAt],
      ["Completed", task.completedAt],
    ]);
  },
});

const startCommand = defineCommand({
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
    const task = await findTaskByPrefix(db, args.taskId);
    if (!task) {
      console.error(`Task not found: ${args.taskId}`);
      process.exit(1);
    }
    const started = await startTask(db, task.id);
    console.log(`Started task '${started.title}' (${shortId(started.id)})`);
  },
});

const doneCommand = defineCommand({
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
    const task = await findTaskByPrefix(db, args.taskId);
    if (!task) {
      console.error(`Task not found: ${args.taskId}`);
      process.exit(1);
    }
    const completed = await completeTask(db, task.id);
    console.log(`Completed task '${completed.title}' (${shortId(completed.id)})`);
  },
});

const blockCommand = defineCommand({
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
    const task = await findTaskByPrefix(db, args.taskId);
    if (!task) {
      console.error(`Task not found: ${args.taskId}`);
      process.exit(1);
    }
    const blocked = await blockTask(db, task.id, args.reason);
    console.log(`Blocked task '${blocked.title}' (${shortId(blocked.id)}): ${args.reason}`);
  },
});

const skipCommand = defineCommand({
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
    const task = await findTaskByPrefix(db, args.taskId);
    if (!task) {
      console.error(`Task not found: ${args.taskId}`);
      process.exit(1);
    }
    const skipped = await skipTask(db, task.id, args.reason);
    console.log(`Skipped task '${skipped.title}' (${shortId(skipped.id)}): ${args.reason}`);
  },
});

export const taskCommand = defineCommand({
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
