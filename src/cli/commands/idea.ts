import { Effect, Schema } from "effect";
import { readFile } from "node:fs/promises";
import { command } from "#/cli/command";
import { runEffect } from "#/cli/runtime";
import * as DomainIdeas from "#/modules/ideas/domain";
import { logActivity } from "#/modules/activity/domain";
import { formatRelativeTime } from "#/shared/utils";
import { VALID_IDEA_STATUSES, type IdeaStatus } from "#/shared/validator";
import { IdeaNotFoundError, IdeaNotOpenError } from "#/shared/errors";

/**
 * `depot idea …` CLI surface (PRD 0027 / T2-T3). A deliberately thin,
 * project-scoped backlog that sits *before* the commitment a PRD represents.
 * Capture is the priority: `idea add <title>` is the fastest command in depot.
 *
 * Mutations emit an `activity_log` row keyed by the idea's `projectId` (ideas
 * are not tied to a PRD revision, so `prdRevisionId` stays unset). The domain
 * stays log-free — the CLI owns activity logging, on the prototype module's
 * model. `promote` logs BOTH `idea_promoted` and `prd_created` because the PRD
 * is created inside the domain transaction.
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Read body text from `--body`, `--body-file <path>`, or `--body-file -` (stdin). */
const resolveBody = async (
  output: { error: (code: string, message: string) => never },
  value: string | undefined,
  file: string | undefined,
): Promise<string | undefined> => {
  if (value !== undefined && file !== undefined) {
    return output.error("conflicting_input", "Provide either --body or --body-file, not both.");
  }
  if (file === undefined) return value;
  if (file === "-") {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks).toString("utf-8");
  }
  try {
    return await readFile(file, "utf-8");
  } catch (e) {
    return output.error(
      "file_read_error",
      `Cannot read file '${file}': ${e instanceof Error ? e.message : String(e)}`,
    );
  }
};

// ── add ───────────────────────────────────────────────────────────────────────

const addCommand = command({
  meta: {
    name: "add",
    description:
      "Capture an uncommitted idea (title only required; --body / --body-file - for a rationale)",
  },
  workspace: true,
  args: {
    title: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Idea title (the only required field)",
    },
    body: {
      schema: Schema.String,
      description: "Optional markdown rationale (inline)",
    },
    bodyFile: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      description: "Read the body from a UTF-8 file, or '-' for stdin",
    },
    tag: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      description: "Optional single kebab-case tag for grouping",
    },
  },
  run: async ({ args, ws, output }) => {
    const body = await resolveBody(output, args.body, args.bodyFile);
    const idea = await runEffect(
      DomainIdeas.createIdea({
        projectId: ws.projectId,
        title: args.title,
        body: body ?? null,
        tag: args.tag ?? null,
      }),
    );
    await runEffect(
      logActivity({
        projectId: idea.projectId,
        eventType: "idea_created",
        payload: { ideaId: idea.id, title: idea.title, tag: idea.tag },
        source: "human",
      }).pipe(Effect.catchAll(() => Effect.succeed(undefined))),
    );
    if (output.isJson()) output.success({ item: idea });
    else output.print(`Captured idea '${idea.title}' (${idea.id}) [open]`);
  },
});

// ── list ──────────────────────────────────────────────────────────────────────

const listCommand = command({
  meta: {
    name: "list",
    description: "List ideas (default open, newest-first) with age + tag and an open-count footer",
  },
  workspace: true,
  args: {
    status: {
      schema: Schema.Literal(...VALID_IDEA_STATUSES),
      expected: `one of ${VALID_IDEA_STATUSES.join(", ")}`,
      description: "Filter by status (defaults to open)",
    },
    tag: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      description: "Filter by tag",
    },
  },
  run: async ({ args, ws, output }) => {
    const status = (args.status as IdeaStatus | undefined) ?? "open";
    const items = await runEffect(
      DomainIdeas.listIdeas(ws.projectId, {
        status,
        ...(args.tag !== undefined ? { tag: args.tag } : {}),
      }),
    );
    const openCount = await runEffect(
      DomainIdeas.listIdeas(ws.projectId, { status: "open" }).pipe(Effect.map((o) => o.length)),
    );

    if (output.isJson()) {
      output.success({ items, openCount });
      return;
    }
    if (items.length === 0) {
      output.print('No ideas. Capture one with `depot idea add "<title>"`.');
    } else {
      for (const idea of items) {
        const tag = idea.tag ? ` [${idea.tag}]` : "";
        output.print(`${idea.id}  ${idea.title}  (${formatRelativeTime(idea.createdAt)})${tag}`);
      }
    }
    output.print(`${openCount} open`);
  },
});

// ── show ──────────────────────────────────────────────────────────────────────

const showCommand = command({
  meta: { name: "show", description: "Show an idea's full body, status, and linked PRD" },
  workspace: true,
  args: {
    id: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Idea ID",
    },
  },
  run: async ({ args, output }) => {
    const idea = await runEffect(
      DomainIdeas.getIdea(args.id).pipe(
        Effect.catchTag("IdeaNotFoundError", () => Effect.succeed(null)),
      ),
    );
    if (!idea) return output.error("not_found", `Idea not found: ${args.id}`);
    if (output.isJson()) {
      output.success({ item: idea });
      return;
    }
    output.fields([
      ["ID", idea.id],
      ["Title", idea.title],
      ["Status", idea.status],
      ["Tag", idea.tag],
      ["Promoted PRD", idea.promotedPrdId],
      ["Dropped reason", idea.droppedReason],
    ]);
    output.print("");
    output.print(idea.body ?? "(no body)");
  },
});

// ── edit ──────────────────────────────────────────────────────────────────────

const editCommand = command({
  meta: { name: "edit", description: "Edit an idea's title / body / tag in place" },
  workspace: true,
  args: {
    id: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Idea ID",
    },
    title: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      description: "New title",
    },
    body: {
      schema: Schema.String,
      description: "New markdown body (inline)",
    },
    bodyFile: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      description: "Read the new body from a UTF-8 file, or '-' for stdin",
    },
    tag: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      description: "New single kebab-case tag",
    },
  },
  run: async ({ args, output }) => {
    if (
      args.title === undefined &&
      args.body === undefined &&
      args.bodyFile === undefined &&
      args.tag === undefined
    ) {
      return output.error("no_changes", "No changes provided. Use --title, --body, or --tag.");
    }
    const body = await resolveBody(output, args.body, args.bodyFile);

    const changes: { title?: string; body?: string | null; tag?: string | null } = {};
    if (args.title !== undefined) changes.title = args.title;
    if (body !== undefined) changes.body = body;
    if (args.tag !== undefined) changes.tag = args.tag;

    const updated = await runEffect(
      DomainIdeas.updateIdea(args.id, changes).pipe(
        Effect.catchTag("IdeaNotFoundError", () => Effect.succeed(null)),
      ),
    );
    if (!updated) return output.error("not_found", `Idea not found: ${args.id}`);

    const fields = Object.keys(changes);
    await runEffect(
      logActivity({
        projectId: updated.projectId,
        eventType: "idea_updated",
        payload: { ideaId: updated.id, title: updated.title, fields },
        source: "human",
      }).pipe(Effect.catchAll(() => Effect.succeed(undefined))),
    );
    if (output.isJson()) output.success({ item: updated });
    else output.print(`Updated idea '${updated.title}' (${updated.id})`);
  },
});

// ── drop ──────────────────────────────────────────────────────────────────────

const dropCommand = command({
  meta: { name: "drop", description: "Drop an idea (open → dropped). No mandatory reason." },
  workspace: true,
  args: {
    id: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Idea ID",
    },
    reason: {
      schema: Schema.String,
      description: "Optional reason recorded on the idea_dropped event",
    },
  },
  run: async ({ args, output }) => {
    const dropped = await runEffect(
      DomainIdeas.dropIdea(args.id, { reason: args.reason ?? null }).pipe(
        Effect.catchTag("IdeaNotFoundError", () => Effect.succeed(null)),
        Effect.catchTag("InvalidTransitionError", (e) => {
          output.error("invalid_transition", e.message);
          return Effect.succeed(null);
        }),
      ),
    );
    if (!dropped) return output.error("not_found", `Idea not found: ${args.id}`);

    await runEffect(
      logActivity({
        projectId: dropped.projectId,
        eventType: "idea_dropped",
        payload: { ideaId: dropped.id, reason: dropped.droppedReason },
        source: "human",
      }).pipe(Effect.catchAll(() => Effect.succeed(undefined))),
    );
    if (output.isJson()) output.success({ item: dropped });
    else output.print(`Dropped idea '${dropped.title}' (${dropped.id})`);
  },
});

// ── reopen ─────────────────────────────────────────────────────────────────────

const reopenCommand = command({
  meta: { name: "reopen", description: "Reopen a dropped idea (dropped → open)" },
  workspace: true,
  args: {
    id: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Idea ID",
    },
  },
  run: async ({ args, output }) => {
    const reopened = await runEffect(
      DomainIdeas.reopenIdea(args.id).pipe(
        Effect.catchTag("IdeaNotFoundError", () => Effect.succeed(null)),
        Effect.catchTag("InvalidTransitionError", (e) => {
          output.error("invalid_transition", e.message);
          return Effect.succeed(null);
        }),
      ),
    );
    if (!reopened) return output.error("not_found", `Idea not found: ${args.id}`);

    await runEffect(
      logActivity({
        projectId: reopened.projectId,
        eventType: "idea_reopened",
        payload: { ideaId: reopened.id },
        source: "human",
      }).pipe(Effect.catchAll(() => Effect.succeed(undefined))),
    );
    if (output.isJson()) output.success({ item: reopened });
    else output.print(`Reopened idea '${reopened.title}' (${reopened.id})`);
  },
});

// ── promote ─────────────────────────────────────────────────────────────────────

const promoteCommand = command({
  meta: {
    name: "promote",
    description: "Promote an open idea into a draft PRD (seeds title + body, carries the tag)",
  },
  workspace: true,
  args: {
    id: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Idea ID",
    },
    title: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      description: "Override the new PRD's title (defaults to the idea title)",
    },
  },
  run: async ({ args, output }) => {
    const result = await runEffect(
      DomainIdeas.promoteIdea(args.id, args.title !== undefined ? { title: args.title } : {}).pipe(
        Effect.match({
          onSuccess: (item) => ({ kind: "ok" as const, item }),
          onFailure: (err) => ({ kind: "err" as const, err }),
        }),
      ),
    );
    if (result.kind === "err") {
      const e = result.err;
      if (e._tag === "IdeaNotFoundError") {
        return output.error("not_found", `Idea not found: ${args.id}`);
      }
      if (e._tag === "IdeaNotOpenError") {
        return output.error("not_open", e.message);
      }
      throw e;
    }

    const { idea, prd } = result.item;
    const promotedPrdId = idea.promotedPrdId ?? prd.prdId;

    await runEffect(
      logActivity({
        projectId: idea.projectId,
        prdRevisionId: prd.id,
        eventType: "prd_created",
        payload: { prdId: prd.prdId, title: prd.title },
        source: "human",
      }).pipe(Effect.catchAll(() => Effect.succeed(undefined))),
    );
    await runEffect(
      logActivity({
        projectId: idea.projectId,
        prdRevisionId: prd.id,
        eventType: "idea_promoted",
        payload: { ideaId: idea.id, promotedPrdId },
        source: "human",
      }).pipe(Effect.catchAll(() => Effect.succeed(undefined))),
    );

    if (output.isJson()) {
      output.success({ idea, prd });
    } else {
      output.print(
        `Promoted idea '${idea.title}' (${idea.id}) → draft PRD ${prd.id} (logical ${prd.prdId})`,
      );
    }
  },
});

// Silence unused error tag literals — they document the error contract.
void IdeaNotFoundError;
void IdeaNotOpenError;

export const ideaCommand = command({
  meta: {
    name: "idea",
    description: "Capture, recall, and promote uncommitted ideas (the pre-PRD backlog)",
  },
  subCommands: {
    add: addCommand,
    list: listCommand,
    show: showCommand,
    edit: editCommand,
    drop: dropCommand,
    reopen: reopenCommand,
    promote: promoteCommand,
  },
});
