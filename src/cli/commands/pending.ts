import { Schema } from "effect";
import { command } from "#/cli/command";
import { runEffect } from "#/cli/runtime";
import * as DomainPending from "#/modules/pending/domain";
import * as DomainProjectConfig from "#/modules/projects/config";
import { formatRelativeTime } from "#/shared/utils";

const DEFAULT_PENDING_TTL_DAYS = 7;

async function readTtlDays(projectId: string): Promise<number> {
  const row = await runEffect(DomainProjectConfig.getConfig(projectId, "pendingActionTtlDays"));
  const parsed = row?.value ? Number(row.value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PENDING_TTL_DAYS;
}

const listCommand = command({
  meta: { name: "list", description: "List pending actions for the current project" },
  workspace: true,
  args: {
    status: {
      schema: Schema.Literal("pending", "consumed", "dismissed"),
      default: "pending",
      description: "Filter by status",
    },
    limit: {
      schema: Schema.Int.pipe(Schema.positive()),
      coerce: "integer",
      default: 20,
      description: "Maximum rows to return",
    },
  },
  run: async ({ args, ws, output }) => {
    // Lazy TTL pass: auto-dismiss expired pending actions before listing so
    // the user / hook never sees stale items. Skipped when listing non-pending.
    if (args.status === "pending") {
      const ttlDays = await readTtlDays(ws.projectId);
      await runEffect(DomainPending.autoDismissExpired(ws.projectId, ttlDays));
    }

    const items = await runEffect(
      DomainPending.listPendingActions(ws.projectId, {
        status: args.status,
        limit: args.limit,
      }),
    );
    if (output.isJson()) {
      output.success({ items });
      return;
    }
    if (items.length === 0) {
      output.print(`No ${args.status} actions.`);
      return;
    }
    output.print(`${items.length} ${args.status} action(s):`);
    let idx = 1;
    for (const it of items) {
      output.print(`  [${idx}] ${formatRelativeTime(it.createdAt)}  ${it.humanReadableLabel}`);
      output.print(`       → ${it.slashCommand}  (id=${it.id})`);
      idx += 1;
    }
  },
});

const showCommand = command({
  meta: { name: "show", description: "Show a pending action's details" },
  args: {
    id: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Pending action ID",
    },
  },
  run: async ({ args, output }) => {
    const item = await runEffect(DomainPending.getPendingAction(args.id));
    if (!item) return output.error("not_found", `Pending action not found: ${args.id}`);
    if (output.isJson()) {
      output.success({ item });
    } else {
      output.fields([
        ["ID", item.id],
        ["Kind", item.kind],
        ["Status", item.status],
        ["Label", item.humanReadableLabel],
        ["Slash command", item.slashCommand],
        ["Source PRD", item.sourcePrdId],
        ["Payload", item.payload],
        ["Created", item.createdAt.toISOString()],
        ["Consumed at", item.consumedAt?.toISOString() ?? null],
        ["Consumed by", item.consumedBySource],
      ]);
    }
  },
});

const consumeCommand = command({
  meta: { name: "consume", description: "Mark a pending action consumed" },
  args: {
    id: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Pending action ID",
    },
    source: {
      schema: Schema.Literal("ai", "human"),
      default: "ai",
      description: "Who consumed it (agent or human)",
    },
  },
  run: async ({ args, output }) => {
    const item = await runEffect(DomainPending.consumePendingAction(args.id, args.source));
    if (output.isJson()) output.success({ item });
    else output.print(`Consumed ${item.id} (${item.kind})`);
  },
});

const dismissCommand = command({
  meta: { name: "dismiss", description: "Dismiss a pending action" },
  args: {
    id: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Pending action ID",
    },
  },
  run: async ({ args, output }) => {
    const item = await runEffect(DomainPending.dismissPendingAction(args.id));
    if (!item) return output.error("not_found", `Pending action not found: ${args.id}`);
    if (output.isJson()) output.success({ item });
    else output.print(`Dismissed ${item.id}`);
  },
});

const pushCommand = command({
  meta: {
    name: "push",
    description: "Programmatically push a pending action (used by web endpoints)",
  },
  workspace: true,
  args: {
    kind: {
      schema: Schema.Literal(
        "advance-phase",
        "resume-with-review",
        "run-doc-sync",
        "run-ship",
        "submit-review",
        "custom",
      ),
      required: true,
      description: "Action kind",
    },
    slashCommand: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      description: "Slash command to suggest",
    },
    label: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      description: "Human-readable label",
    },
    sourcePrd: { schema: Schema.String.pipe(Schema.minLength(1)) },
    payloadJson: { schema: Schema.String },
  },
  run: async ({ args, ws, output }) => {
    let payload: Record<string, unknown> | undefined;
    if (args.payloadJson) {
      try {
        payload = JSON.parse(args.payloadJson) as Record<string, unknown>;
      } catch (e) {
        return output.error(
          "invalid_json",
          `--payload-json is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    const item = await runEffect(
      DomainPending.pushPendingAction({
        projectId: ws.projectId,
        kind: args.kind,
        slashCommand: args.slashCommand,
        humanReadableLabel: args.label,
        sourcePrdId: args.sourcePrd,
        payload,
      }),
    );
    if (output.isJson()) output.success({ item });
    else output.print(`Queued action ${item.id} (${item.kind}) → ${item.slashCommand}`);
  },
});

export const pendingCommand = command({
  meta: { name: "pending", description: "Pending actions (web ↔ chat bridge)" },
  subCommands: {
    list: listCommand,
    show: showCommand,
    consume: consumeCommand,
    dismiss: dismissCommand,
    push: pushCommand,
  },
});
