import { defineCommand } from "citty";
import { resolveCurrentWorkspace } from "#/cli/context";
import { logActivity, listActivity, findPrdByPrefix, findTaskByPrefix } from "#/lib/workflow";
import { eventTypeSchema, jsonString, parseJsonLike, validateArgs } from "#/lib/schemas";
import * as z from "zod";

// ── Validation schema ─────────────────────────────────────────────────────────

const addLogSchema = z.object({
  eventType: eventTypeSchema,
  payload: jsonString,
});

// ── Commands ──────────────────────────────────────────────────────────────────

const addCommand = defineCommand({
  meta: { name: "add", description: "Log an activity event" },
  args: {
    eventType: {
      type: "positional",
      description: "Event type (session_start, note, error, etc.)",
      required: true,
    },
    task: {
      type: "string",
      description: "Associated task ID",
    },
    prd: {
      type: "string",
      description: "Associated PRD ID",
    },
    payload: {
      type: "string",
      description: "JSON payload",
      default: "{}",
    },
  },
  setup({ args }) {
    validateArgs(addLogSchema, {
      eventType: args.eventType,
      payload: args.payload ?? "{}",
    });
  },
  run: async ({ args }) => {
    const { db, ws } = await resolveCurrentWorkspace();
    const payload = parseJsonLike(args.payload ?? "{}");
    const prd = args.prd ? await findPrdByPrefix(db, args.prd) : null;
    if (args.prd && !prd) {
      console.error(`PRD not found: ${args.prd}`);
      process.exit(1);
    }

    const task = args.task ? await findTaskByPrefix(db, args.task) : null;
    if (args.task && !task) {
      console.error(`Task not found: ${args.task}`);
      process.exit(1);
    }

    const entry = await logActivity(db, {
      projectId: ws.projectId,
      workspaceId: ws.id,
      prdId: prd?.id,
      taskId: task?.id,
      eventType: args.eventType,
      payload,
    });
    console.log(`Logged ${args.eventType} (id=${entry.id})`);
  },
});

const listCommand = defineCommand({
  meta: { name: "list", description: "List recent activity" },
  args: {
    last: {
      type: "string",
      alias: "n",
      description: "Number of entries to show",
      default: "20",
    },
  },
  run: async ({ args }) => {
    const { db, ws } = await resolveCurrentWorkspace();
    const limit = parseInt(args.last ?? "20", 10);
    const entries = await listActivity(db, {
      projectId: ws.projectId,
      limit,
    });
    if (entries.length === 0) {
      console.log("No activity logged yet.");
      return;
    }
    for (const e of entries) {
      const payload = JSON.parse(e.payload);
      const summary = Object.values(payload).join(" ").slice(0, 80);
      console.log(`${e.createdAt}  ${e.eventType}  ${summary}`);
    }
  },
});

export const logCommand = defineCommand({
  meta: { name: "log", description: "Activity logging" },
  subCommands: {
    add: addCommand,
    list: listCommand,
  },
});
