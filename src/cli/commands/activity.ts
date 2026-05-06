import { Schema } from "effect";
import { command } from "#/cli/command";
import { runEffect } from "#/cli/runtime";
import * as DomainActivity from "#/modules/activity/domain";
import * as DomainPrds from "#/modules/prds/domain";
import * as DomainTasks from "#/modules/tasks/domain";
import { eventTypeSchema, parseJsonLike } from "#/shared/schemas";
import { formatDate } from "#/shared/utils";
import { summarizeActivityPayload } from "#/modules/activity/domain";

// ── Commands ──────────────────────────────────────────────────────────────────

const addCommand = command({
  meta: { name: "add", description: "Log an activity event" },
  workspace: true,
  args: {
    eventType: {
      schema: eventTypeSchema,
      required: true,
      positional: true,
      expected: "a supported event type",
      description: "Event type (session_start, note, error, etc.)",
    },
    task: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      description: "Associated task ID",
    },
    prd: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      description: "Associated PRD ID",
    },
    payload: {
      schema: Schema.String,
      default: "{}",
      description: "JSON payload",
    },
  },
  run: async ({ args, ws, output }) => {
    let payload: Record<string, unknown>;
    try {
      payload = parseJsonLike(args.payload);
    } catch (e) {
      return output.error("invalid_payload", e instanceof Error ? e.message : String(e));
    }

    const prd = args.prd ? await runEffect(DomainPrds.getPrd(args.prd)) : null;
    if (args.prd && !prd) {
      return output.error("not_found", `PRD not found: ${args.prd}`);
    }

    const task = args.task ? await runEffect(DomainTasks.getTask(args.task)) : null;
    if (args.task && !task) {
      return output.error("not_found", `Task not found: ${args.task}`);
    }

    const entry = await runEffect(
      DomainActivity.logActivity({
        projectId: ws.projectId,
        workspaceId: ws.id,
        prdRevisionId: prd?.id,
        taskId: task?.id,
        eventType: args.eventType,
        payload,
      }),
    );

    if (output.isJson()) {
      output.success({
        item: {
          ...entry,
          payload: JSON.parse(entry.payload) as Record<string, unknown>,
        },
      });
    } else {
      output.print(`Logged ${args.eventType} (id=${entry.id})`);
    }
  },
});

const listCommand = command({
  meta: { name: "list", description: "List recent activity" },
  workspace: true,
  args: {
    last: {
      schema: Schema.NumberFromString.pipe(
        Schema.filter((n) => Number.isInteger(n) && n > 0, {
          message: () => "--last / -n must be a positive integer",
        }),
      ),
      default: "20",
      alias: "n",
      expected: "a positive integer",
      description: "Number of entries to show",
    },
    workspace: {
      schema: Schema.Boolean,
      type: "boolean",
      default: false,
      alias: "w",
      description: "Filter by current workspace only (default shows whole project)",
    },
  },
  run: async ({ args, ws, output }) => {
    const entries = await runEffect(
      DomainActivity.listActivity({
        projectId: ws.projectId,
        workspaceId: args.workspace ? ws.id : undefined,
        limit: args.last,
      }),
    );
    if (output.isJson()) {
      output.success({
        items: entries.map((e) => ({
          ...e,
          payload: JSON.parse(e.payload) as Record<string, unknown>,
        })),
      });
      return;
    }
    if (entries.length === 0) {
      output.print("No activity logged yet.");
      return;
    }
    for (const e of entries) {
      const p = JSON.parse(e.payload) as Record<string, unknown>;
      const summary = summarizeActivityPayload(e.eventType, p);
      output.print(`${formatDate(e.createdAt)}  ${e.eventType}  ${summary}`);
    }
  },
});

export const logCommand = command({
  meta: { name: "log", description: "Activity logging" },
  subCommands: {
    add: addCommand,
    list: listCommand,
  },
});
