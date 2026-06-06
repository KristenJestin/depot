import { Effect, Schema } from "effect";
import { readFile } from "node:fs/promises";
import { command } from "#/cli/command";
import { runEffect } from "#/cli/runtime";
import * as DomainPrds from "#/modules/prds/domain";
import * as DomainPrototypes from "#/modules/prds/prototypes";
import { logActivity } from "#/modules/activity/domain";
import {
  FeedbackOnStaleVersionError,
  PrototypeNotFoundError,
  PrototypePageNotFoundError,
  PrototypeVariantNotFoundError,
  PrototypeVersionNotFoundError,
  FeedbackNotFoundError,
} from "#/shared/errors";
import { VALID_FEEDBACK_STATUSES } from "#/shared/validator";

/**
 * `depot prd prototype …` CLI surface (PRD 0025 / T1). One sub-command per
 * domain entity (prototype / page / version / variant / feedback) plus the
 * top-level CRUD wrappers. Every command accepts `--json`.
 *
 * All mutations emit an `activity_log` row keyed by `projectId +
 * prdRevisionId` so the existing live activity panel surfaces them without a
 * dedicated event surface. Failures are mapped to a stable error code (e.g.
 * `stale_version` → 409 on the web API side).
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

const lookupPrd = async (prdRevisionId: string) => {
  const prd = await runEffect(DomainPrds.getPrd(prdRevisionId));
  return prd;
};

// ── Top-level prototype CRUD ─────────────────────────────────────────────────

const protoCreateCommand = command({
  meta: { name: "create", description: "Create a prototype on a PRD revision" },
  args: {
    prdId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "PRD revision ID",
    },
    slug: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Kebab-case slug, unique per revision",
    },
    description: {
      schema: Schema.String,
      description: "Free-form description",
    },
  },
  run: async ({ args, output }) => {
    const prd = await lookupPrd(args.prdId);
    if (!prd) return output.error("not_found", `PRD not found: ${args.prdId}`);
    const proto = await runEffect(
      DomainPrototypes.createPrototype({
        prdRevisionId: prd.id,
        slug: args.slug,
        description: args.description ?? null,
      }),
    );
    await runEffect(
      logActivity({
        projectId: prd.projectId,
        workspaceId: prd.workspaceId ?? undefined,
        prdRevisionId: prd.id,
        eventType: "prototype_created",
        payload: { prototypeId: proto.id, prdRevisionId: prd.id, slug: proto.slug },
        source: "human",
      }).pipe(Effect.catchAll(() => Effect.succeed(undefined))),
    );
    if (output.isJson()) output.success({ item: proto });
    else output.print(`Created prototype '${proto.slug}' (${proto.id})`);
  },
});

const protoListCommand = command({
  meta: { name: "list", description: "List prototypes for a PRD revision" },
  args: {
    prdId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "PRD revision ID",
    },
  },
  run: async ({ args, output }) => {
    const prd = await lookupPrd(args.prdId);
    if (!prd) return output.error("not_found", `PRD not found: ${args.prdId}`);
    const items = await runEffect(DomainPrototypes.listPrototypes(prd.id));
    if (output.isJson()) {
      output.success({ items });
      return;
    }
    if (items.length === 0) {
      output.print("No prototypes attached to this PRD.");
      return;
    }
    for (const proto of items) {
      const archived = proto.archivedAt ? " [archived]" : "";
      output.print(`${proto.id}  ${proto.slug}${archived}`);
    }
  },
});

const protoShowCommand = command({
  meta: { name: "show", description: "Show a prototype tree (pages → versions → variants)" },
  args: {
    prototypeId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Prototype ID",
    },
  },
  run: async ({ args, output }) => {
    const tree = await runEffect(
      DomainPrototypes.loadPrototypeTree(args.prototypeId).pipe(
        Effect.catchTag("PrototypeNotFoundError", () => Effect.succeed(null)),
      ),
    );
    if (!tree) return output.error("not_found", `Prototype not found: ${args.prototypeId}`);
    if (output.isJson()) {
      output.success({ item: tree });
      return;
    }
    output.print(`Prototype: ${tree.prototype.slug} (${tree.prototype.id})`);
    for (const pageEntry of tree.pages) {
      output.print(`  Page: ${pageEntry.page.slug} — ${pageEntry.page.title}`);
      for (const versionEntry of pageEntry.versions) {
        const tag = versionEntry.version.archivedAt ? " [archived]" : "";
        output.print(`    Version ${versionEntry.version.label}${tag}`);
        for (const variant of versionEntry.variants) {
          const main = variant.isMain ? " [main]" : "";
          output.print(`      Variant ${variant.label}${main} — ${variant.title} (${variant.id})`);
        }
      }
    }
  },
});

const protoArchiveCommand = command({
  meta: { name: "archive", description: "Archive a prototype (keeps rows queryable)" },
  args: {
    prototypeId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Prototype ID",
    },
  },
  run: async ({ args, output }) => {
    const proto = await runEffect(
      DomainPrototypes.getPrototype(args.prototypeId).pipe(
        Effect.catchTag("PrototypeNotFoundError", () => Effect.succeed(null)),
      ),
    );
    if (!proto) return output.error("not_found", `Prototype not found: ${args.prototypeId}`);
    const archived = await runEffect(DomainPrototypes.archivePrototype(proto.id));
    const prd = await runEffect(DomainPrds.getPrd(proto.prdRevisionId));
    if (prd) {
      await runEffect(
        logActivity({
          projectId: prd.projectId,
          workspaceId: prd.workspaceId ?? undefined,
          prdRevisionId: prd.id,
          eventType: "prototype_archived",
          payload: { prototypeId: proto.id },
          source: "human",
        }).pipe(Effect.catchAll(() => Effect.succeed(undefined))),
      );
    }
    if (output.isJson()) output.success({ item: archived });
    else output.print(`Archived prototype ${proto.slug} (${proto.id})`);
  },
});

// ── Pages ────────────────────────────────────────────────────────────────────

const pageAddCommand = command({
  meta: { name: "add", description: "Add a page to a prototype" },
  args: {
    prototypeId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Prototype ID",
    },
    slug: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      description: "Page slug (kebab-case)",
    },
    title: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      description: "Page title",
    },
    position: {
      schema: Schema.Number,
      coerce: "integer",
      expected: "an integer",
      description: "Display position",
    },
  },
  run: async ({ args, output }) => {
    const proto = await runEffect(
      DomainPrototypes.getPrototype(args.prototypeId).pipe(
        Effect.catchTag("PrototypeNotFoundError", () => Effect.succeed(null)),
      ),
    );
    if (!proto) return output.error("not_found", `Prototype not found: ${args.prototypeId}`);
    const page = await runEffect(
      DomainPrototypes.addPage({
        prototypeId: proto.id,
        slug: args.slug,
        title: args.title,
        position: args.position,
      }),
    );
    const prd = await runEffect(DomainPrds.getPrd(proto.prdRevisionId));
    if (prd) {
      await runEffect(
        logActivity({
          projectId: prd.projectId,
          workspaceId: prd.workspaceId ?? undefined,
          prdRevisionId: prd.id,
          eventType: "prototype_page_added",
          payload: {
            prototypeId: proto.id,
            pageId: page.id,
            slug: page.slug,
            title: page.title,
          },
          source: "human",
        }).pipe(Effect.catchAll(() => Effect.succeed(undefined))),
      );
    }
    if (output.isJson()) output.success({ item: page });
    else output.print(`Added page '${page.slug}' (${page.id}) to prototype ${proto.slug}`);
  },
});

const pageRmCommand = command({
  meta: { name: "rm", description: "Remove a page (use --cascade to drop versions+variants)" },
  args: {
    pageId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Page ID",
    },
    cascade: {
      schema: Schema.Boolean,
      type: "boolean",
      description: "Cascade-delete every version + variant + feedback under the page",
    },
  },
  run: async ({ args, output }) => {
    const page = await runEffect(
      DomainPrototypes.getPage(args.pageId).pipe(
        Effect.catchTag("PrototypePageNotFoundError", () => Effect.succeed(null)),
      ),
    );
    if (!page) return output.error("not_found", `Page not found: ${args.pageId}`);
    const removed = await runEffect(
      DomainPrototypes.removePage(page.id, { cascade: args.cascade === true }),
    );
    if (output.isJson()) output.success({ item: removed });
    else output.print(`Removed page ${removed.slug} (${removed.id})`);
  },
});

const pageCommand = command({
  meta: { name: "page", description: "Page management for a prototype" },
  subCommands: { add: pageAddCommand, rm: pageRmCommand },
});

// ── Versions ─────────────────────────────────────────────────────────────────

const versionAddCommand = command({
  meta: { name: "add", description: "Add a version to a page" },
  args: {
    pageId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Page ID",
    },
    label: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      description: "Version label (e.g. v1, v2-rework)",
    },
    summary: { schema: Schema.String, description: "Free-form summary" },
  },
  run: async ({ args, output }) => {
    const page = await runEffect(
      DomainPrototypes.getPage(args.pageId).pipe(
        Effect.catchTag("PrototypePageNotFoundError", () => Effect.succeed(null)),
      ),
    );
    if (!page) return output.error("not_found", `Page not found: ${args.pageId}`);
    const version = await runEffect(
      DomainPrototypes.addVersion({
        pageId: page.id,
        label: args.label,
        summary: args.summary ?? null,
      }),
    );
    const proto = await runEffect(DomainPrototypes.getPrototype(page.prototypeId));
    const prd = await runEffect(DomainPrds.getPrd(proto.prdRevisionId));
    if (prd) {
      await runEffect(
        logActivity({
          projectId: prd.projectId,
          workspaceId: prd.workspaceId ?? undefined,
          prdRevisionId: prd.id,
          eventType: "prototype_version_added",
          payload: { pageId: page.id, versionId: version.id, label: version.label },
          source: "human",
        }).pipe(Effect.catchAll(() => Effect.succeed(undefined))),
      );
    }
    if (output.isJson()) output.success({ item: version });
    else output.print(`Added version ${version.label} (${version.id}) on page ${page.slug}`);
  },
});

const versionArchiveCommand = command({
  meta: { name: "archive", description: "Archive a page version" },
  args: {
    versionId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Page version ID",
    },
  },
  run: async ({ args, output }) => {
    const v = await runEffect(
      DomainPrototypes.getVersion(args.versionId).pipe(
        Effect.catchTag("PrototypeVersionNotFoundError", () => Effect.succeed(null)),
      ),
    );
    if (!v) return output.error("not_found", `Version not found: ${args.versionId}`);
    await runEffect(DomainPrototypes.archiveVersion(v.id));
    if (output.isJson()) output.success({ versionId: v.id });
    else output.print(`Archived version ${v.label} (${v.id})`);
  },
});

const versionRestoreCommand = command({
  meta: { name: "restore", description: "Restore a previously archived page version" },
  args: {
    versionId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Page version ID",
    },
  },
  run: async ({ args, output }) => {
    const v = await runEffect(
      DomainPrototypes.getVersion(args.versionId).pipe(
        Effect.catchTag("PrototypeVersionNotFoundError", () => Effect.succeed(null)),
      ),
    );
    if (!v) return output.error("not_found", `Version not found: ${args.versionId}`);
    await runEffect(DomainPrototypes.restoreVersion(v.id));
    if (output.isJson()) output.success({ versionId: v.id });
    else output.print(`Restored version ${v.label} (${v.id})`);
  },
});

const versionCommand = command({
  meta: { name: "version", description: "Version management for a page" },
  subCommands: {
    add: versionAddCommand,
    archive: versionArchiveCommand,
    restore: versionRestoreCommand,
  },
});

// ── Variants ─────────────────────────────────────────────────────────────────

const variantAddCommand = command({
  meta: { name: "add", description: "Add a variant to a page version (HTML from --file)" },
  args: {
    versionId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Page version ID",
    },
    label: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      description: "Variant label",
    },
    title: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      description: "Variant title",
    },
    file: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      description: "Path to the HTML file (self-contained, CSS inline)",
    },
    position: {
      schema: Schema.Number,
      coerce: "integer",
      expected: "an integer",
      description: "Display position",
    },
    main: {
      schema: Schema.Boolean,
      type: "boolean",
      description: "Promote this variant to `is_main` atomically",
    },
    allowExternal: {
      schema: Schema.Boolean,
      type: "boolean",
      description:
        "Store the variant even if its HTML references external resources (CDN/scripts/styles) the sandboxed iframe cannot load",
    },
  },
  run: async ({ args, output }) => {
    const version = await runEffect(
      DomainPrototypes.getVersion(args.versionId).pipe(
        Effect.catchTag("PrototypeVersionNotFoundError", () => Effect.succeed(null)),
      ),
    );
    if (!version) return output.error("not_found", `Version not found: ${args.versionId}`);

    let htmlContent: string;
    try {
      htmlContent = await readFile(args.file, "utf-8");
    } catch (e) {
      return output.error(
        "io_error",
        `Could not read --file ${args.file}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    const outcome = await runEffect(
      DomainPrototypes.addVariant({
        pageVersionId: version.id,
        label: args.label,
        title: args.title,
        htmlContent,
        position: args.position,
        markMain: args.main === true,
        allowExternal: args.allowExternal === true,
      }).pipe(
        Effect.map((variant) => ({ ok: true as const, variant })),
        Effect.catchTag("PrototypeVariantExternalResourcesError", (e) =>
          Effect.succeed({ ok: false as const, resources: e.resources }),
        ),
      ),
    );
    if (!outcome.ok) {
      const list = outcome.resources.map((r) => `  - ${r.reason} (line ${r.line})`).join("\n");
      return output.error(
        "external_resources",
        `HTML not self-contained — will render blank in the sandboxed iframe (sandbox="allow-scripts", CSP blocks external resources):\n${list}\nInline your CSS/JS, or pass --allow-external to store anyway.`,
      );
    }
    const variant = outcome.variant;

    const page = await runEffect(DomainPrototypes.getPage(version.pageId));
    const proto = await runEffect(DomainPrototypes.getPrototype(page.prototypeId));
    const prd = await runEffect(DomainPrds.getPrd(proto.prdRevisionId));
    if (prd) {
      await runEffect(
        logActivity({
          projectId: prd.projectId,
          workspaceId: prd.workspaceId ?? undefined,
          prdRevisionId: prd.id,
          eventType: "prototype_variant_added",
          payload: {
            pageVersionId: version.id,
            variantId: variant.id,
            label: variant.label,
            isMain: variant.isMain,
          },
          source: "human",
        }).pipe(Effect.catchAll(() => Effect.succeed(undefined))),
      );
    }

    if (output.isJson()) output.success({ item: variant });
    else
      output.print(
        `Added variant ${variant.label}${variant.isMain ? " [main]" : ""} (${variant.id}) to version ${version.label}`,
      );
  },
});

const variantRmCommand = command({
  meta: { name: "rm", description: "Remove a variant (and its feedback)" },
  args: {
    variantId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Variant ID",
    },
  },
  run: async ({ args, output }) => {
    const v = await runEffect(
      DomainPrototypes.getVariant(args.variantId).pipe(
        Effect.catchTag("PrototypeVariantNotFoundError", () => Effect.succeed(null)),
      ),
    );
    if (!v) return output.error("not_found", `Variant not found: ${args.variantId}`);
    await runEffect(DomainPrototypes.removeVariant(v.id));
    if (output.isJson()) output.success({ variantId: v.id });
    else output.print(`Removed variant ${v.label} (${v.id})`);
  },
});

const variantSetMainCommand = command({
  meta: { name: "set-main", description: "Promote a variant to `is_main` atomically" },
  args: {
    variantId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Variant ID",
    },
  },
  run: async ({ args, output }) => {
    const v = await runEffect(
      DomainPrototypes.getVariant(args.variantId).pipe(
        Effect.catchTag("PrototypeVariantNotFoundError", () => Effect.succeed(null)),
      ),
    );
    if (!v) return output.error("not_found", `Variant not found: ${args.variantId}`);
    const result = await runEffect(DomainPrototypes.setMainVariant(v.id));
    const version = await runEffect(DomainPrototypes.getVersion(v.pageVersionId));
    const page = await runEffect(DomainPrototypes.getPage(version.pageId));
    const proto = await runEffect(DomainPrototypes.getPrototype(page.prototypeId));
    const prd = await runEffect(DomainPrds.getPrd(proto.prdRevisionId));
    if (prd) {
      await runEffect(
        logActivity({
          projectId: prd.projectId,
          workspaceId: prd.workspaceId ?? undefined,
          prdRevisionId: prd.id,
          eventType: "prototype_variant_main_changed",
          payload: {
            pageVersionId: v.pageVersionId,
            previousMainVariantId: result.previousMainId,
            newMainVariantId: v.id,
          },
          source: "human",
        }).pipe(Effect.catchAll(() => Effect.succeed(undefined))),
      );
    }
    if (output.isJson()) output.success({ item: result.variant });
    else output.print(`Promoted variant ${v.label} (${v.id}) to main`);
  },
});

/**
 * Resolve a `--round` argument (round id or label) to a round id within a
 * prototype, defaulting to the current round when omitted. Returns `null` when
 * an explicit round was given but not found.
 */
const resolveRoundArg = (prototypeId: string, round: string | undefined) =>
  Effect.gen(function* () {
    if (!round) {
      const current = yield* DomainPrototypes.getCurrentRound(prototypeId);
      return current?.id ?? null;
    }
    const rounds = yield* DomainPrototypes.listRounds(prototypeId);
    const match = rounds.find((r) => r.id === round || r.label === round);
    return match?.id ?? null;
  });

const variantElectCommand = command({
  meta: {
    name: "elect",
    description: "Elect a variant as THE design for its page in a round (PRD 0028 / 0030)",
  },
  args: {
    variantId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Variant ID to elect",
    },
    rationale: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      alias: "r",
      description: "Why this variant was chosen (recorded as the arbitration)",
    },
    by: {
      schema: Schema.String,
      description: "Who arbitrated (e.g. 'direction') — recorded for the audit trail",
    },
    round: {
      schema: Schema.String,
      description: "Round id or label to elect in (defaults to the current round)",
    },
  },
  run: async ({ args, output }) => {
    const v = await runEffect(
      DomainPrototypes.getVariant(args.variantId).pipe(
        Effect.catchTag("PrototypeVariantNotFoundError", () => Effect.succeed(null)),
      ),
    );
    if (!v) return output.error("not_found", `Variant not found: ${args.variantId}`);
    const version = await runEffect(DomainPrototypes.getVersion(v.pageVersionId));
    const page = await runEffect(DomainPrototypes.getPage(version.pageId));
    const roundId = await runEffect(resolveRoundArg(page.prototypeId, args.round));
    if (args.round && !roundId) {
      return output.error("not_found", `Round not found (id or label): ${args.round}`);
    }
    const election = await runEffect(
      DomainPrototypes.electVariant(v.id, {
        rationale: args.rationale,
        decidedBy: args.by ?? null,
        roundId,
      }),
    );
    const proto = await runEffect(DomainPrototypes.getPrototype(election.page.prototypeId));
    const prd = await runEffect(DomainPrds.getPrd(proto.prdRevisionId));
    if (prd) {
      await runEffect(
        logActivity({
          projectId: prd.projectId,
          workspaceId: prd.workspaceId ?? undefined,
          prdRevisionId: prd.id,
          eventType: "prototype_variant_elected",
          payload: {
            pageId: election.page.id,
            roundId: election.roundId,
            variantId: v.id,
            rationale: args.rationale,
            decidedBy: args.by ?? null,
          },
          source: "human",
        }).pipe(Effect.catchAll(() => Effect.succeed(undefined))),
      );
    }
    if (output.isJson()) output.success({ item: election });
    else
      output.print(
        `Elected variant ${v.label} (${v.id}) as the design for page '${election.page.slug}'`,
      );
  },
});

const variantUnelectCommand = command({
  meta: {
    name: "unelect",
    description: "Clear a page's election in a round (revert to no design chosen)",
  },
  args: {
    variantId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "A variant on the page whose election to clear",
    },
    round: {
      schema: Schema.String,
      description: "Round id or label to clear in (defaults to the current round)",
    },
  },
  run: async ({ args, output }) => {
    const v = await runEffect(
      DomainPrototypes.getVariant(args.variantId).pipe(
        Effect.catchTag("PrototypeVariantNotFoundError", () => Effect.succeed(null)),
      ),
    );
    if (!v) return output.error("not_found", `Variant not found: ${args.variantId}`);
    const version = await runEffect(DomainPrototypes.getVersion(v.pageVersionId));
    const page = await runEffect(DomainPrototypes.getPage(version.pageId));
    const roundId = await runEffect(resolveRoundArg(page.prototypeId, args.round));
    if (args.round && !roundId) {
      return output.error("not_found", `Round not found (id or label): ${args.round}`);
    }
    const election = await runEffect(DomainPrototypes.clearElection(version.pageId, { roundId }));
    const proto = await runEffect(DomainPrototypes.getPrototype(election.page.prototypeId));
    const prd = await runEffect(DomainPrds.getPrd(proto.prdRevisionId));
    if (prd) {
      await runEffect(
        logActivity({
          projectId: prd.projectId,
          workspaceId: prd.workspaceId ?? undefined,
          prdRevisionId: prd.id,
          eventType: "prototype_variant_unelected",
          payload: { pageId: election.page.id, roundId: election.roundId },
          source: "human",
        }).pipe(Effect.catchAll(() => Effect.succeed(undefined))),
      );
    }
    if (output.isJson()) output.success({ item: election });
    else output.print(`Cleared election for page '${election.page.slug}'`);
  },
});

const variantCommand = command({
  meta: { name: "variant", description: "Variant management for a page version" },
  subCommands: {
    add: variantAddCommand,
    rm: variantRmCommand,
    "set-main": variantSetMainCommand,
    elect: variantElectCommand,
    unelect: variantUnelectCommand,
  },
});

// ── Feedback ─────────────────────────────────────────────────────────────────

const feedbackListCommand = command({
  meta: {
    name: "list",
    description: "List feedbacks across every prototype on a PRD revision",
  },
  args: {
    prdId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "PRD revision ID",
    },
    status: {
      schema: Schema.Literal(...VALID_FEEDBACK_STATUSES),
      expected: `one of ${VALID_FEEDBACK_STATUSES.join(", ")}`,
      description: "Filter by status",
    },
    variant: {
      schema: Schema.String,
      description: "Filter by variant ID",
    },
  },
  run: async ({ args, output }) => {
    const prd = await lookupPrd(args.prdId);
    if (!prd) return output.error("not_found", `PRD not found: ${args.prdId}`);
    const items = await runEffect(
      DomainPrototypes.listFeedbacks(prd.id, {
        ...(args.status ? { status: args.status } : {}),
        ...(args.variant ? { variantId: args.variant } : {}),
      }),
    );
    if (output.isJson()) {
      output.success({ items });
      return;
    }
    if (items.length === 0) {
      output.print("No feedback matched the filter.");
      return;
    }
    for (const fb of items) {
      const pin = fb.selectorCss ? `[${fb.selectorCss}] ` : "";
      // `resolved` is a display-only label: the row is still persisted as `open`
      // (the "addressed" bucket is derived from version churn), but an agent
      // annotation via `feedback resolve` sets `resolvedAt`, so surface it here
      // instead of the counter-intuitive bare `[open]`.
      const status =
        fb.status === "ignored" ? "[ignored]" : fb.resolvedAt ? "[resolved]" : "[open]";
      output.print(`${fb.id}  ${status} ${pin}${fb.text}`);
    }
  },
});

const feedbackResolveCommand = command({
  meta: {
    name: "resolve",
    description: "Annotate a feedback as resolved by the agent (status stays open)",
  },
  args: {
    feedbackId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Feedback ID",
    },
    note: { schema: Schema.String, description: "Free-form annotation" },
    viaVariant: {
      schema: Schema.String,
      description: "Variant ID that addresses the feedback (audit log)",
    },
  },
  run: async ({ args, output }) => {
    const updated = await runEffect(
      DomainPrototypes.resolveFeedback(args.feedbackId, {
        note: args.note ?? null,
        viaVariantId: args.viaVariant ?? null,
      }).pipe(
        Effect.catchTag("FeedbackNotFoundError", () => Effect.succeed(null)),
        Effect.catchTag("PrototypeVariantNotFoundError", () => Effect.succeed(null)),
      ),
    );
    if (!updated) return output.error("not_found", `Feedback or via-variant not found.`);
    const variant = await runEffect(DomainPrototypes.getVariant(updated.variantId));
    const version = await runEffect(DomainPrototypes.getVersion(variant.pageVersionId));
    const page = await runEffect(DomainPrototypes.getPage(version.pageId));
    const proto = await runEffect(DomainPrototypes.getPrototype(page.prototypeId));
    const prd = await runEffect(DomainPrds.getPrd(proto.prdRevisionId));
    if (prd) {
      await runEffect(
        logActivity({
          projectId: prd.projectId,
          workspaceId: prd.workspaceId ?? undefined,
          prdRevisionId: prd.id,
          eventType: "prototype_feedback_resolved",
          payload: {
            feedbackId: updated.id,
            variantId: updated.variantId,
            viaVariantId: updated.resolutionViaVariantId ?? null,
            hasNote: updated.resolutionNote !== null,
          },
          source: "human",
        }).pipe(Effect.catchAll(() => Effect.succeed(undefined))),
      );
    }
    if (output.isJson()) output.success({ item: updated });
    else output.print(`Resolved feedback ${updated.id}`);
  },
});

const feedbackIgnoreCommand = command({
  meta: {
    name: "ignore",
    description: "Ignore a feedback (--reason mandatory)",
  },
  args: {
    feedbackId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Feedback ID",
    },
    reason: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      description: "Why this feedback is ignored (mandatory)",
    },
  },
  run: async ({ args, output }) => {
    const updated = await runEffect(
      DomainPrototypes.ignoreFeedback(args.feedbackId, { reason: args.reason }).pipe(
        Effect.catchTag("FeedbackNotFoundError", () => Effect.succeed(null)),
      ),
    );
    if (!updated) return output.error("not_found", `Feedback not found: ${args.feedbackId}`);
    const variant = await runEffect(DomainPrototypes.getVariant(updated.variantId));
    const version = await runEffect(DomainPrototypes.getVersion(variant.pageVersionId));
    const page = await runEffect(DomainPrototypes.getPage(version.pageId));
    const proto = await runEffect(DomainPrototypes.getPrototype(page.prototypeId));
    const prd = await runEffect(DomainPrds.getPrd(proto.prdRevisionId));
    if (prd) {
      await runEffect(
        logActivity({
          projectId: prd.projectId,
          workspaceId: prd.workspaceId ?? undefined,
          prdRevisionId: prd.id,
          eventType: "prototype_feedback_ignored",
          payload: {
            feedbackId: updated.id,
            variantId: updated.variantId,
            reason: updated.ignoredReason ?? "",
          },
          source: "human",
        }).pipe(Effect.catchAll(() => Effect.succeed(undefined))),
      );
    }
    if (output.isJson()) output.success({ item: updated });
    else output.print(`Ignored feedback ${updated.id}: ${updated.ignoredReason}`);
  },
});

const feedbackDeleteCommand = command({
  meta: {
    name: "delete",
    description:
      "Hard-delete a feedback (only allowed when it targets the latest non-archived version of its page)",
  },
  args: {
    feedbackId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Feedback ID",
    },
  },
  run: async ({ args, output }) => {
    const fb = await runEffect(
      DomainPrototypes.getFeedback(args.feedbackId).pipe(
        Effect.catchTag("FeedbackNotFoundError", () => Effect.succeed(null)),
      ),
    );
    if (!fb) return output.error("not_found", `Feedback not found: ${args.feedbackId}`);

    let deleted: typeof fb;
    try {
      deleted = await runEffect(DomainPrototypes.deleteFeedback(args.feedbackId));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/no longer the latest non-archived/i.test(msg)) {
        return output.error("stale_version", msg);
      }
      throw e;
    }

    const variant = await runEffect(DomainPrototypes.getVariant(deleted.variantId));
    const version = await runEffect(DomainPrototypes.getVersion(variant.pageVersionId));
    const page = await runEffect(DomainPrototypes.getPage(version.pageId));
    const proto = await runEffect(DomainPrototypes.getPrototype(page.prototypeId));
    const prd = await runEffect(DomainPrds.getPrd(proto.prdRevisionId));
    if (prd) {
      await runEffect(
        logActivity({
          projectId: prd.projectId,
          workspaceId: prd.workspaceId ?? undefined,
          prdRevisionId: prd.id,
          eventType: "prototype_feedback_deleted",
          payload: {
            feedbackId: deleted.id,
            variantId: deleted.variantId,
            hasPin: deleted.selectorCss !== null,
          },
          source: "human",
        }).pipe(Effect.catchAll(() => Effect.succeed(undefined))),
      );
    }
    if (output.isJson()) output.success({ item: deleted });
    else output.print(`Deleted feedback ${deleted.id}`);
  },
});

const feedbackCommand = command({
  meta: { name: "feedback", description: "Feedback management on a prototype variant" },
  subCommands: {
    list: feedbackListCommand,
    resolve: feedbackResolveCommand,
    ignore: feedbackIgnoreCommand,
    delete: feedbackDeleteCommand,
  },
});

// Silence unused error tag literals — they document the error contract.
void FeedbackOnStaleVersionError;
void PrototypeNotFoundError;
void PrototypePageNotFoundError;
void PrototypeVariantNotFoundError;
void PrototypeVersionNotFoundError;
void FeedbackNotFoundError;

const protoDistillCommand = command({
  meta: {
    name: "distill",
    description:
      "Distill a page's validated placement for a round (PRD 0030): where elements go, in what order (the dev contract)",
  },
  args: {
    pageId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Page ID whose placement to distill",
    },
    round: {
      schema: Schema.String,
      description: "Round id or label to distill in (defaults to the current round)",
    },
    spec: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      alias: "s",
      description:
        "Placement spec markdown, structured by convention (Regions / Order / Hierarchy / States / Interactions)",
    },
    specFile: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      description: "Read the placement spec from a UTF-8 text file",
    },
  },
  run: async ({ args, output }) => {
    const page = await runEffect(
      DomainPrototypes.getPage(args.pageId).pipe(
        Effect.catchTag("PrototypePageNotFoundError", () => Effect.succeed(null)),
      ),
    );
    if (!page) return output.error("not_found", `Page not found: ${args.pageId}`);

    const spec = args.specFile ? await readFile(args.specFile, "utf8") : (args.spec ?? "");
    if (spec.trim().length === 0) {
      return output.error(
        "validation_error",
        'Provide --spec "<placement>" or --spec-file <path> with a non-empty placement spec.',
      );
    }

    const roundId = await runEffect(resolveRoundArg(page.prototypeId, args.round));
    if (!roundId) {
      return output.error(
        "not_found",
        args.round
          ? `Round not found (id or label): ${args.round}`
          : `No round on the page's prototype to distill into.`,
      );
    }

    const placement = await runEffect(
      DomainPrototypes.distillPagePlacement(roundId, page.id, { placementSpec: spec }),
    );
    const proto = await runEffect(DomainPrototypes.getPrototype(page.prototypeId));
    const prd = await runEffect(DomainPrds.getPrd(proto.prdRevisionId));
    if (prd) {
      await runEffect(
        logActivity({
          projectId: prd.projectId,
          workspaceId: prd.workspaceId ?? undefined,
          prdRevisionId: prd.id,
          eventType: "prototype_page_placement_distilled",
          payload: {
            roundId,
            pageId: page.id,
            slug: page.slug,
            length: spec.trim().length,
          },
          source: "human",
        }).pipe(Effect.catchAll(() => Effect.succeed(undefined))),
      );
    }
    if (output.isJson()) output.success({ item: placement });
    else
      output.print(
        `Distilled the placement for page '${page.slug}' (${spec.trim().length} chars) in round ${roundId}.`,
      );
  },
});

// ── Rounds (PRD 0029 / Tranche D) ──────────────────────────────────────────
//
// A round is a whole-design round: a named, manifest-pinned snapshot of which
// page version ships together. The current round (max position) is the only
// mutable one. These commands edit the manifest; logging is emitted here (the
// domain stays log-free), keyed by the round's prototype → prd revision.

/** Resolve the PRD revision row backing a round, for activity logging. */
const prdForRound = (round: DomainPrototypes.PrdPrototypeRoundRow) =>
  Effect.gen(function* () {
    const proto = yield* DomainPrototypes.getPrototype(round.prototypeId);
    return yield* DomainPrds.getPrd(proto.prdRevisionId);
  });

const roundAddCommand = command({
  meta: { name: "add", description: "Open a new whole-design round on a prototype" },
  args: {
    prototypeId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Prototype ID",
    },
    label: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      description: "Round label (kebab-case), unique per prototype",
    },
    from: {
      schema: Schema.String,
      description: "Clone the manifest from another round (id or label)",
    },
    fromCurrent: {
      schema: Schema.Boolean,
      type: "boolean",
      description:
        "Clone the manifest from the current round (the feedback ⇒ new round shortcut; no --from needed)",
    },
    summary: { schema: Schema.String, description: "Free-form summary" },
  },
  run: async ({ args, output }) => {
    const proto = await runEffect(
      DomainPrototypes.getPrototype(args.prototypeId).pipe(
        Effect.catchTag("PrototypeNotFoundError", () => Effect.succeed(null)),
      ),
    );
    if (!proto) return output.error("not_found", `Prototype not found: ${args.prototypeId}`);

    if (args.from && args.fromCurrent) {
      return output.error(
        "validation_error",
        "Pass either --from <round> or --from-current, not both.",
      );
    }

    let fromRoundId: string | null = null;
    if (args.fromCurrent) {
      const current = await runEffect(DomainPrototypes.getCurrentRound(proto.id));
      if (!current) {
        return output.error("not_found", `Prototype ${proto.id} has no current round to clone.`);
      }
      fromRoundId = current.id;
    } else if (args.from) {
      const rounds = await runEffect(DomainPrototypes.listRounds(proto.id));
      const match = rounds.find((r) => r.id === args.from || r.label === args.from);
      if (!match) {
        return output.error("not_found", `Source round not found (id or label): ${args.from}`);
      }
      fromRoundId = match.id;
    }

    const round = await runEffect(
      DomainPrototypes.createRound({
        prototypeId: proto.id,
        label: args.label,
        summary: args.summary ?? null,
        fromRoundId,
      }),
    );
    const prd = await runEffect(DomainPrds.getPrd(proto.prdRevisionId));
    if (prd) {
      await runEffect(
        logActivity({
          projectId: prd.projectId,
          workspaceId: prd.workspaceId ?? undefined,
          prdRevisionId: prd.id,
          eventType: "prototype_round_created",
          payload: {
            prototypeId: proto.id,
            roundId: round.id,
            label: round.label,
            fromRoundId,
          },
          source: "human",
        }).pipe(Effect.catchAll(() => Effect.succeed(undefined))),
      );
    }
    if (output.isJson()) output.success({ item: round });
    else
      output.print(
        `Opened round '${round.label}' (${round.id}) on prototype ${proto.slug}${
          fromRoundId ? " (manifest cloned)" : ""
        }`,
      );
  },
});

const roundListCommand = command({
  meta: { name: "list", description: "List the rounds of a prototype (current is marked)" },
  args: {
    prototypeId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Prototype ID",
    },
  },
  run: async ({ args, output }) => {
    const proto = await runEffect(
      DomainPrototypes.getPrototype(args.prototypeId).pipe(
        Effect.catchTag("PrototypeNotFoundError", () => Effect.succeed(null)),
      ),
    );
    if (!proto) return output.error("not_found", `Prototype not found: ${args.prototypeId}`);

    const rounds = await runEffect(DomainPrototypes.listRounds(proto.id));
    const current = await runEffect(DomainPrototypes.getCurrentRound(proto.id));
    const rows = [];
    for (const round of rounds) {
      const manifest = await runEffect(DomainPrototypes.listRoundPages(round.id));
      rows.push({
        id: round.id,
        position: round.position,
        label: round.label,
        summary: round.summary,
        pages: manifest.length,
        isCurrent: current?.id === round.id,
      });
    }

    if (output.isJson()) {
      output.success({ items: rows });
      return;
    }
    if (rows.length === 0) {
      output.print("No rounds on this prototype.");
      return;
    }
    for (const r of rows) {
      const marker = r.isCurrent ? " *" : "  ";
      const summary = r.summary ? ` — ${r.summary}` : "";
      output.print(`${marker} [${r.position}] ${r.label} (${r.id})  ${r.pages} page(s)${summary}`);
    }
  },
});

const roundPinCommand = command({
  meta: { name: "pin", description: "Pin a specific page version into a round's manifest" },
  args: {
    roundId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Round ID",
    },
    pageId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Page ID",
    },
    version: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      description: "Page version ID to pin",
    },
  },
  run: async ({ args, output }) => {
    const round = await runEffect(
      DomainPrototypes.getRound(args.roundId).pipe(
        Effect.catchTag("PrototypeRoundNotFoundError", () => Effect.succeed(null)),
      ),
    );
    if (!round) return output.error("not_found", `Round not found: ${args.roundId}`);
    const entry = await runEffect(DomainPrototypes.pinPage(round.id, args.pageId, args.version));
    const prd = await runEffect(prdForRound(round));
    if (prd) {
      await runEffect(
        logActivity({
          projectId: prd.projectId,
          workspaceId: prd.workspaceId ?? undefined,
          prdRevisionId: prd.id,
          eventType: "prototype_round_page_pinned",
          payload: {
            roundId: round.id,
            pageId: entry.pageId,
            pageVersionId: entry.pageVersionId,
          },
          source: "human",
        }).pipe(Effect.catchAll(() => Effect.succeed(undefined))),
      );
    }
    if (output.isJson()) output.success({ item: entry });
    else
      output.print(
        `Pinned page ${entry.pageId} to version ${entry.pageVersionId} in round ${round.label}`,
      );
  },
});

const roundIncludeCommand = command({
  meta: {
    name: "include",
    description: "Include a page in a round (pins its latest active version unless --version)",
  },
  args: {
    roundId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Round ID",
    },
    pageId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Page ID",
    },
    version: {
      schema: Schema.String,
      description: "Page version ID to pin (defaults to the latest active version)",
    },
  },
  run: async ({ args, output }) => {
    const round = await runEffect(
      DomainPrototypes.getRound(args.roundId).pipe(
        Effect.catchTag("PrototypeRoundNotFoundError", () => Effect.succeed(null)),
      ),
    );
    if (!round) return output.error("not_found", `Round not found: ${args.roundId}`);
    const entry = await runEffect(
      DomainPrototypes.includePage(round.id, args.pageId, args.version ?? undefined),
    );
    const prd = await runEffect(prdForRound(round));
    if (prd) {
      await runEffect(
        logActivity({
          projectId: prd.projectId,
          workspaceId: prd.workspaceId ?? undefined,
          prdRevisionId: prd.id,
          eventType: "prototype_round_page_pinned",
          payload: {
            roundId: round.id,
            pageId: entry.pageId,
            pageVersionId: entry.pageVersionId,
          },
          source: "human",
        }).pipe(Effect.catchAll(() => Effect.succeed(undefined))),
      );
    }
    if (output.isJson()) output.success({ item: entry });
    else
      output.print(
        `Included page ${entry.pageId} (pinned ${entry.pageVersionId}) in round ${round.label}`,
      );
  },
});

const roundDropCommand = command({
  meta: { name: "drop", description: "Drop a page from a round's manifest" },
  args: {
    roundId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Round ID",
    },
    pageId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Page ID",
    },
  },
  run: async ({ args, output }) => {
    const round = await runEffect(
      DomainPrototypes.getRound(args.roundId).pipe(
        Effect.catchTag("PrototypeRoundNotFoundError", () => Effect.succeed(null)),
      ),
    );
    if (!round) return output.error("not_found", `Round not found: ${args.roundId}`);
    await runEffect(DomainPrototypes.dropPage(round.id, args.pageId));
    const prd = await runEffect(prdForRound(round));
    if (prd) {
      await runEffect(
        logActivity({
          projectId: prd.projectId,
          workspaceId: prd.workspaceId ?? undefined,
          prdRevisionId: prd.id,
          eventType: "prototype_round_page_dropped",
          payload: { roundId: round.id, pageId: args.pageId },
          source: "human",
        }).pipe(Effect.catchAll(() => Effect.succeed(undefined))),
      );
    }
    if (output.isJson()) output.success({ roundId: round.id, pageId: args.pageId });
    else output.print(`Dropped page ${args.pageId} from round ${round.label}`);
  },
});

const roundCommand = command({
  meta: { name: "round", description: "Whole-design round management for a prototype" },
  subCommands: {
    add: roundAddCommand,
    list: roundListCommand,
    pin: roundPinCommand,
    include: roundIncludeCommand,
    drop: roundDropCommand,
  },
});

export const prototypeCommand = command({
  meta: {
    name: "prototype",
    description: "Iterative UI prototypes attached to a PRD revision (pages / versions / variants)",
  },
  subCommands: {
    create: protoCreateCommand,
    list: protoListCommand,
    show: protoShowCommand,
    archive: protoArchiveCommand,
    distill: protoDistillCommand,
    page: pageCommand,
    version: versionCommand,
    variant: variantCommand,
    feedback: feedbackCommand,
    round: roundCommand,
  },
});
