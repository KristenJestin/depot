import { defineValidatedCommand } from "#/cli/command";
import { resolveCurrentWorkspace } from "#/cli/runtime";
import { outputSuccess, outputError, isJsonMode } from "#/cli/output";
import { logActivity, listActivity, getPrd, getTask } from "#/lib/workflow";
import { eventTypeSchema, jsonString } from "#/lib/schemas";
import * as z from "zod";

// ── Validation schema ─────────────────────────────────────────────────────────

const addLogSchema = z.object({
  eventType: eventTypeSchema,
  task: z.string().min(1).optional(),
  prd: z.string().min(1).optional(),
  payload: jsonString,
});

const listLogSchema = z.object({
  last: z.string().min(1).default("20").transform((value, ctx) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      ctx.addIssue({
        code: "custom",
        message: "Must be a positive integer",
      });
      return z.NEVER;
    }
    return parsed;
  }),
});

// ── Commands ──────────────────────────────────────────────────────────────────

const addCommand = defineValidatedCommand({
  schema: addLogSchema,
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
  run: async ({ args }) => {
    const { db, ws } = await resolveCurrentWorkspace();
    const payload = args.payload;
    const prd = args.prd ? await getPrd(db, args.prd) : null;
    if (args.prd && !prd) {
      outputError("not_found", `PRD not found: ${args.prd}`);
    }

    const task = args.task ? await getTask(db, args.task) : null;
    if (args.task && !task) {
      outputError("not_found", `Task not found: ${args.task}`);
    }

    const entry = await logActivity(db, {
      projectId: ws.projectId,
      workspaceId: ws.id,
      prdId: prd?.id,
      taskId: task?.id,
      eventType: args.eventType,
      payload,
    });

    if (isJsonMode()) {
      outputSuccess({
        item: {
          ...entry,
          payload: JSON.parse(entry.payload) as Record<string, unknown>,
        },
      });
    } else {
      console.log(`Logged ${args.eventType} (id=${entry.id})`);
    }
  },
});

const listCommand = defineValidatedCommand({
  schema: listLogSchema,
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
    const entries = await listActivity(db, {
      projectId: ws.projectId,
      limit: args.last,
    });
    if (isJsonMode()) {
      outputSuccess({
        items: entries.map((e) => ({
          ...e,
          payload: JSON.parse(e.payload) as Record<string, unknown>,
        })),
      });
      return;
    }
    if (entries.length === 0) {
      console.log("No activity logged yet.");
      return;
    }
    for (const e of entries) {
      const p = JSON.parse(e.payload);
      const summary = Object.values(p).join(" ").slice(0, 80);
      console.log(`${e.createdAt}  ${e.eventType}  ${summary}`);
    }
  },
});

export const logCommand = defineValidatedCommand({
  schema: z.object({}),
  meta: { name: "log", description: "Activity logging" },
  subCommands: {
    add: addCommand,
    list: listCommand,
  },
});
