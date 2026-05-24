import { Schema } from "effect";
import { command } from "#/cli/command";
import { runEffect } from "#/cli/runtime";
import { resolveTextInput } from "#/cli/file-input";
import { openEditorForText, ADR_BODY_TEMPLATE } from "#/cli/editor";
import * as DomainAdrs from "#/modules/adrs/domain";
import { formatDate } from "#/shared/utils";
import { VALID_ADR_STATUSES, type AdrStatus } from "#/shared/validator";
import type { AdrRow } from "#/db/schema";

const formatAdrLine = (a: AdrRow): string =>
  `${DomainAdrs.formatAdrNumber(a.number)}  ${a.id}  [${a.status}]  ${a.title}`;

const createAdrCommand = command({
  meta: {
    name: "create",
    description:
      "Create a new ADR (architectural decision record) in 'proposed' status. " +
      "If no --body / --body-file is given, opens $EDITOR with a template " +
      "(Context / Decision / Consequences / Alternatives).",
  },
  workspace: true,
  args: {
    title: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      description: "ADR title",
    },
    prd: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      description: "Optional logical PRD ID this ADR is linked to",
    },
    body: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      description: "ADR body markdown (inline)",
    },
    bodyFile: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      description: "Path to a file containing the ADR body markdown",
    },
  },
  run: async ({ args, ws, output }) => {
    let body = await resolveTextInput({
      output,
      value: args.body,
      file: args.bodyFile,
      valueFlag: "--body",
      fileFlag: "--body-file",
      expected: "non-empty markdown body",
    });

    if (body === undefined) {
      try {
        body = openEditorForText({ initialContent: ADR_BODY_TEMPLATE, extension: ".md" });
      } catch (e) {
        return output.error(
          "editor_failed",
          e instanceof Error ? e.message : "Failed to capture ADR body from $EDITOR.",
        );
      }
    }

    const adr = await runEffect(
      DomainAdrs.createAdr({
        projectId: ws.projectId,
        prdId: args.prd ?? null,
        title: args.title,
        body,
      }),
    );

    if (output.isJson()) {
      output.success({ item: adr, displayId: DomainAdrs.formatAdrNumber(adr.number) });
      return;
    }
    output.print(
      `Created ${DomainAdrs.formatAdrNumber(adr.number)} (${adr.id}) [${adr.status}]: ${adr.title}`,
    );
  },
});

const listAdrsCommand = command({
  meta: { name: "list", description: "List ADRs for the current project (optionally filtered)" },
  workspace: true,
  args: {
    prd: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      description: "Filter by linked logical PRD ID",
    },
    status: {
      schema: Schema.Literal(...VALID_ADR_STATUSES),
      description: `Filter by status (${VALID_ADR_STATUSES.join("|")})`,
    },
  },
  run: async ({ args, ws, output }) => {
    const items = await runEffect(
      DomainAdrs.listAdrs({
        projectId: ws.projectId,
        prdId: args.prd,
        status: args.status as AdrStatus | undefined,
      }),
    );
    if (output.isJson()) {
      output.success({ items });
      return;
    }
    if (items.length === 0) {
      output.print("No ADRs.");
      return;
    }
    for (const a of items) output.print(formatAdrLine(a));
  },
});

const showAdrCommand = command({
  meta: {
    name: "show",
    description: "Show an ADR's full body and superseding context",
  },
  workspace: true,
  args: {
    id: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "ADR id (full ULID), `ADR-NNNN`, or the bare per-project number",
    },
  },
  run: async ({ args, ws, output }) => {
    const resolved = await runEffect(DomainAdrs.resolveAdrRef(ws.projectId, args.id));
    if (!resolved) {
      return output.error("not_found", `ADR not found: ${args.id}`);
    }
    const view = await runEffect(DomainAdrs.getAdr(resolved.id));
    if (!view) {
      return output.error("not_found", `ADR not found: ${args.id}`);
    }
    if (output.isJson()) {
      output.success({
        item: view.adr,
        displayId: DomainAdrs.formatAdrNumber(view.adr.number),
        supersededBy: view.supersededBy
          ? {
              id: view.supersededBy.id,
              displayId: DomainAdrs.formatAdrNumber(view.supersededBy.number),
              title: view.supersededBy.title,
            }
          : null,
        supersedes: view.supersedes
          ? {
              id: view.supersedes.id,
              displayId: DomainAdrs.formatAdrNumber(view.supersedes.number),
              title: view.supersedes.title,
            }
          : null,
      });
      return;
    }
    output.fields([
      ["ID", view.adr.id],
      ["Number", DomainAdrs.formatAdrNumber(view.adr.number)],
      ["Title", view.adr.title],
      ["Status", view.adr.status],
      ["Project", view.adr.projectId],
      ["PRD", view.adr.prdId],
      [
        "Superseded by",
        view.supersededBy
          ? `${DomainAdrs.formatAdrNumber(view.supersededBy.number)} (${view.supersededBy.id}) — ${view.supersededBy.title}`
          : null,
      ],
      [
        "Supersedes",
        view.supersedes
          ? `${DomainAdrs.formatAdrNumber(view.supersedes.number)} (${view.supersedes.id}) — ${view.supersedes.title}`
          : null,
      ],
      ["Created", formatDate(view.adr.createdAt)],
      ["Updated", formatDate(view.adr.updatedAt)],
    ]);
    output.print("");
    output.print(view.adr.body);
  },
});

const acceptAdrCommand = command({
  meta: { name: "accept", description: "Mark a proposed ADR as accepted" },
  workspace: true,
  args: {
    id: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "ADR id (full ULID), `ADR-NNNN`, or the bare per-project number",
    },
  },
  run: async ({ args, ws, output }) => {
    const resolved = await runEffect(DomainAdrs.resolveAdrRef(ws.projectId, args.id));
    if (!resolved) {
      return output.error("not_found", `ADR not found: ${args.id}`);
    }
    const updated = await runEffect(DomainAdrs.acceptAdr(resolved.id));
    if (output.isJson()) {
      output.success({ item: updated, displayId: DomainAdrs.formatAdrNumber(updated.number) });
      return;
    }
    output.print(
      `Accepted ${DomainAdrs.formatAdrNumber(updated.number)} (${updated.id}): ${updated.title}`,
    );
  },
});

const supersedeAdrCommand = command({
  meta: {
    name: "supersede",
    description:
      "Replace an ADR with a new accepted ADR. The old ADR is marked 'superseded' " +
      "and the new one carries a fresh contiguous number — both in a single transaction.",
  },
  workspace: true,
  args: {
    id: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Old ADR to supersede (full ULID, `ADR-NNNN`, or bare number)",
    },
    title: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      description: "Title of the replacement ADR",
    },
    prd: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      description: "Optional logical PRD ID to attach the new ADR to",
    },
    body: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      description: "Replacement ADR body markdown (inline)",
    },
    bodyFile: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      description: "Path to a file containing the replacement ADR body markdown",
    },
  },
  run: async ({ args, ws, output }) => {
    const old = await runEffect(DomainAdrs.resolveAdrRef(ws.projectId, args.id));
    if (!old) {
      return output.error("not_found", `ADR not found: ${args.id}`);
    }

    let body = await resolveTextInput({
      output,
      value: args.body,
      file: args.bodyFile,
      valueFlag: "--body",
      fileFlag: "--body-file",
      expected: "non-empty markdown body",
    });

    if (body === undefined) {
      try {
        body = openEditorForText({ initialContent: ADR_BODY_TEMPLATE, extension: ".md" });
      } catch (e) {
        return output.error(
          "editor_failed",
          e instanceof Error ? e.message : "Failed to capture ADR body from $EDITOR.",
        );
      }
    }

    const result = await runEffect(
      DomainAdrs.supersedeAdr(old.id, {
        title: args.title,
        body,
        prdId: args.prd ?? null,
      }),
    );

    if (output.isJson()) {
      output.success({
        oldAdr: result.oldAdr,
        newAdr: result.newAdr,
        oldDisplayId: DomainAdrs.formatAdrNumber(result.oldAdr.number),
        newDisplayId: DomainAdrs.formatAdrNumber(result.newAdr.number),
      });
      return;
    }
    output.print(
      `Superseded ${DomainAdrs.formatAdrNumber(result.oldAdr.number)} (${result.oldAdr.id}) ` +
        `with ${DomainAdrs.formatAdrNumber(result.newAdr.number)} (${result.newAdr.id}): ${result.newAdr.title}`,
    );
  },
});

export const adrCommand = command({
  meta: { name: "adr", description: "Architectural decision records" },
  subCommands: {
    create: createAdrCommand,
    list: listAdrsCommand,
    show: showAdrCommand,
    accept: acceptAdrCommand,
    supersede: supersedeAdrCommand,
  },
});
