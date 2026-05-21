import { Schema } from "effect";
import { command } from "#/cli/command";
import { runEffect } from "#/cli/runtime";
import * as DomainDocs from "#/modules/docs/domain";
import * as DomainDocSync from "#/modules/docs/sync";
import * as DomainDirectives from "#/modules/projects/directives";
import { logActivity } from "#/modules/activity/domain";
import { VALID_DOC_KINDS } from "#/shared/validator";

const adrNextNumberCommand = command({
  meta: { name: "next-number", description: "Output the next free ADR number for the project" },
  workspace: true,
  args: {},
  run: async ({ ws, output }) => {
    const n = await runEffect(DomainDocs.nextAdrNumber(ws.projectId));
    if (output.isJson()) output.success({ number: n });
    else output.print(`${n}`);
  },
});

const adrSupersedeCommand = command({
  meta: { name: "supersede", description: "Mark an ADR as superseded by another" },
  workspace: true,
  args: {
    oldNumber: {
      schema: Schema.Int.pipe(Schema.positive()),
      coerce: "integer",
      required: true,
      positional: true,
      description: "Number of the ADR being superseded",
    },
    by: {
      schema: Schema.Int.pipe(Schema.positive()),
      coerce: "integer",
      required: true,
      description: "Number of the superseding ADR",
    },
  },
  run: async ({ args, ws, output }) => {
    const item = await runEffect(DomainDocs.supersedeAdr(ws.projectId, args.oldNumber, args.by));
    if (output.isJson()) output.success({ item });
    else output.print(`ADR #${args.oldNumber} superseded by #${args.by}`);
  },
});

const adrCommand = command({
  meta: { name: "adr", description: "ADR management" },
  subCommands: { "next-number": adrNextNumberCommand, supersede: adrSupersedeCommand },
});

const listCommand = command({
  meta: { name: "list", description: "List doc artifacts for the current project" },
  workspace: true,
  args: {
    kind: {
      schema: Schema.Literal(...VALID_DOC_KINDS),
      expected: `one of ${VALID_DOC_KINDS.join(", ")}`,
      description: "Filter by kind",
    },
  },
  run: async ({ args, ws, output }) => {
    const items = await runEffect(DomainDocs.listDocArtifacts(ws.projectId, { kind: args.kind }));
    if (output.isJson()) {
      output.success({ items });
      return;
    }
    if (items.length === 0) {
      output.print("No doc artifacts.");
      return;
    }
    for (const a of items) {
      const number = a.number !== null ? `#${a.number} ` : "";
      const status = a.status ? ` [${a.status}]` : "";
      output.print(`${a.id}  ${a.kind}  ${number}${a.title}${status}  -- ${a.path}`);
    }
  },
});

const touchCommand = command({
  meta: { name: "touch", description: "Register or update a doc artifact entry" },
  workspace: true,
  args: {
    path: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Path of the artifact (relative to workspace)",
    },
    kind: {
      schema: Schema.Literal(...VALID_DOC_KINDS),
      required: true,
      description: "Artifact kind",
    },
    title: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      alias: "t",
      description: "Artifact title (defaults to basename)",
    },
    number: {
      schema: Schema.Int.pipe(Schema.positive()),
      coerce: "integer",
      description: "ADR number (kind=adr)",
    },
    status: {
      schema: Schema.Literal("proposed", "accepted", "superseded"),
      description: "ADR status (kind=adr)",
    },
    linkedPrd: { schema: Schema.String.pipe(Schema.minLength(1)) },
    source: {
      schema: Schema.Literal("ai", "human"),
      default: "ai",
      description: "Origin of the modification",
    },
  },
  run: async ({ args, ws, output }) => {
    const item = await runEffect(
      DomainDocs.registerDocArtifact({
        projectId: ws.projectId,
        workspaceId: ws.id,
        kind: args.kind,
        path: args.path,
        title: args.title ?? args.path.split("/").pop()!,
        number: args.number,
        status: args.status,
        linkedPrdRevisionId: args.linkedPrd,
        source: args.source,
      }),
    );
    if (output.isJson()) output.success({ item });
    else
      output.print(
        `Touched doc artifact ${item.id} (${item.kind}) at ${item.path}${item.number ? ` #${item.number}` : ""}`,
      );
  },
});

// ── Doc profiles ──────────────────────────────────────────────────────────────

const profileCreateCommand = command({
  meta: { name: "create", description: "Create a doc profile" },
  workspace: true,
  args: {
    name: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Profile name",
    },
    targetRoot: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      description: "Target docs root (path)",
    },
  },
  run: async ({ args, ws, output }) => {
    const item = await runEffect(
      DomainDocSync.createProfile({
        projectId: ws.projectId,
        name: args.name,
        targetRoot: args.targetRoot,
      }),
    );
    if (output.isJson()) output.success({ item });
    else output.print(`Created doc profile '${item.name}' (${item.id})`);
  },
});

const profileSetCommand = command({
  meta: { name: "set", description: "Update a doc profile's properties" },
  workspace: true,
  args: {
    name: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Profile name",
    },
    targetRoot: { schema: Schema.String.pipe(Schema.minLength(1)) },
    language: { schema: Schema.String.pipe(Schema.minLength(1)) },
    style: { schema: Schema.Literal("narrative", "reference", "mixed") },
    audience: { schema: Schema.String },
    addSource: {
      schema: Schema.String,
      description:
        "Add a source in 'name=path' form (e.g. 'api=./nyx-api'). Repeat with comma.",
    },
    sourcesJson: {
      schema: Schema.String,
      description: "Replace sources with a JSON array",
    },
    guardrails: { schema: Schema.String, description: "Comma-separated guardrails" },
    commitPolicy: { schema: Schema.Literal("leave-in-working-tree", "commit-with-message") },
  },
  run: async ({ args, ws, output }) => {
    let sources: DomainDocSync.DocSource[] | undefined;
    if (args.sourcesJson) {
      try {
        sources = JSON.parse(args.sourcesJson) as DomainDocSync.DocSource[];
      } catch (e) {
        return output.error(
          "invalid_json",
          `--sources-json is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    } else if (args.addSource) {
      const existing = await runEffect(DomainDocSync.getProfile(ws.projectId, args.name));
      if (!existing) return output.error("not_found", `Doc profile '${args.name}' not found`);
      sources = JSON.parse(existing.sources) as DomainDocSync.DocSource[];
      for (const piece of args.addSource.split(",")) {
        const eq = piece.indexOf("=");
        if (eq === -1) {
          return output.error(
            "invalid_format",
            `--add-source expects 'name=path' format, got '${piece}'`,
          );
        }
        const name = piece.slice(0, eq).trim();
        const path = piece.slice(eq + 1).trim();
        if (!name || !path) {
          return output.error(
            "invalid_format",
            `--add-source name and path must be non-empty, got '${piece}'`,
          );
        }
        sources.push({ name, path });
      }
    }
    const updated = await runEffect(
      DomainDocSync.updateProfile(ws.projectId, args.name, {
        targetRoot: args.targetRoot,
        language: args.language,
        style: args.style,
        audience: args.audience,
        sources,
        guardrails: args.guardrails
          ? args.guardrails
              .split(",")
              .map((s) => s.trim())
              .filter((s) => s.length > 0)
          : undefined,
        commitPolicy: args.commitPolicy,
      }),
    );
    if (output.isJson()) output.success({ item: updated });
    else output.print(`Updated doc profile '${updated.name}'`);
  },
});

const profileShowCommand = command({
  meta: { name: "show", description: "Show a doc profile" },
  workspace: true,
  args: {
    name: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Profile name",
    },
  },
  run: async ({ args, ws, output }) => {
    const item = await runEffect(DomainDocSync.getProfile(ws.projectId, args.name));
    if (!item) return output.error("not_found", `Doc profile '${args.name}' not found`);
    if (output.isJson()) output.success({ item });
    else {
      output.print(`Profile: ${item.name}`);
      output.print(`  Target root:    ${item.targetRoot}`);
      output.print(`  Target pattern: ${item.targetPattern}`);
      output.print(`  Sources:        ${item.sources}`);
      output.print(`  Style:          ${item.style}`);
      output.print(`  Language:       ${item.language}`);
      output.print(`  Guardrails:     ${item.guardrails}`);
      output.print(`  Commit policy:  ${item.commitPolicy}`);
    }
  },
});

const profileListCommand = command({
  meta: { name: "list", description: "List doc profiles for the project" },
  workspace: true,
  args: {},
  run: async ({ ws, output }) => {
    const items = await runEffect(DomainDocSync.listProfiles(ws.projectId));
    if (output.isJson()) {
      output.success({ items });
      return;
    }
    if (items.length === 0) {
      output.print("No doc profiles.");
      return;
    }
    for (const p of items) {
      output.print(`${p.id}  ${p.name}  -- target=${p.targetRoot}  style=${p.style}`);
    }
  },
});

const profileDeleteCommand = command({
  meta: { name: "delete", description: "Delete a doc profile" },
  workspace: true,
  args: {
    name: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Profile name",
    },
  },
  run: async ({ args, ws, output }) => {
    await runEffect(DomainDocSync.deleteProfile(ws.projectId, args.name));
    if (output.isJson()) output.success({ name: args.name });
    else output.print(`Deleted doc profile '${args.name}'`);
  },
});

const profileCommand = command({
  meta: { name: "profile", description: "Doc profile management" },
  subCommands: {
    create: profileCreateCommand,
    set: profileSetCommand,
    show: profileShowCommand,
    list: profileListCommand,
    delete: profileDeleteCommand,
  },
});

// ── Doc sync ─────────────────────────────────────────────────────────────────

const syncCommand = command({
  meta: { name: "sync", description: "Resolve the diff range for a doc profile" },
  workspace: true,
  args: {
    name: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Profile name",
    },
    since: { schema: Schema.String, description: "Git ref or expression like '15 days ago'" },
    until: { schema: Schema.String },
    prd: { schema: Schema.String.pipe(Schema.minLength(1)), description: "PRD revision ID" },
    dryRun: {
      schema: Schema.Boolean,
      type: "boolean",
      default: true,
      description: "Only resolve the range, do not write a sync run (default true)",
    },
  },
  run: async ({ args, ws, output }) => {
    const resolved = await runEffect(
      DomainDocSync.resolveDiffRange({
        profileName: args.name,
        projectId: ws.projectId,
        prdRevisionId: args.prd,
        sinceExpr: args.since,
        untilExpr: args.until,
      }),
    );

    if (!args.dryRun) {
      await runEffect(
        DomainDocSync.recordSyncRun({
          profileId: resolved.profileId,
          triggeredByPrdId: args.prd,
          sinceRef: args.since ?? resolved.sources[0]?.since ?? undefined,
          untilRef: args.until ?? undefined,
        }),
      );
    }

    if (output.isJson()) {
      output.success({ ...resolved, dryRun: args.dryRun });
      return;
    }
    output.print(`Profile: ${args.name}${args.dryRun ? "  (dry run)" : ""}`);
    for (const s of resolved.sources) {
      output.print(`  ${s.name} @ ${s.path}  since=${s.since}  until=${s.until}  [${s.mode}]`);
    }
  },
});

const syncHistoryCommand = command({
  meta: { name: "sync-history", description: "List previous sync runs for a profile" },
  workspace: true,
  args: {
    name: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Profile name",
    },
    prd: { schema: Schema.String.pipe(Schema.minLength(1)) },
    limit: { schema: Schema.Int.pipe(Schema.positive()), coerce: "integer" },
  },
  run: async ({ args, ws, output }) => {
    const profile = await runEffect(DomainDocSync.getProfile(ws.projectId, args.name));
    if (!profile) return output.error("not_found", `Doc profile '${args.name}' not found`);
    const runs = await runEffect(
      DomainDocSync.listSyncRuns(profile.id, { prdId: args.prd, limit: args.limit }),
    );
    if (output.isJson()) {
      output.success({ items: runs });
      return;
    }
    if (runs.length === 0) {
      output.print("No sync runs.");
      return;
    }
    for (const r of runs) {
      output.print(
        `${r.id}  ranAt=${r.ranAt.toISOString()}  since=${r.sinceRef ?? "—"}  triggeredByPrd=${r.triggeredByPrdId ?? "—"}`,
      );
    }
  },
});

const preSyncCheckCommand = command({
  meta: {
    name: "pre-sync-check",
    description: "Run blocking pre-doc-sync directives for a doc profile",
  },
  workspace: true,
  args: {
    profile: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Doc profile name (used to resolve the workspace context)",
    },
  },
  run: async ({ args, ws, output }) => {
    const profile = await runEffect(DomainDocSync.getProfile(ws.projectId, args.profile));
    if (!profile) return output.error("not_found", `Doc profile '${args.profile}' not found`);
    const result = await runEffect(
      DomainDirectives.runScopeBlocking(ws.projectId, "pre-doc-sync", { wsPath: ws.path }),
    );
    await runEffect(
      logActivity({
        projectId: ws.projectId,
        workspaceId: ws.id,
        eventType: "pre_doc_sync_check",
        payload: { ok: result.ok, failingDirectiveId: result.failingDirectiveId },
      }),
    );
    if (output.isJson()) {
      output.success(result);
    } else {
      output.print(
        `Running ${result.results.length} pre-doc-sync directive(s) for profile '${args.profile}':`,
      );
      for (const r of result.results) {
        const icon = r.ok ? "✓" : "✗";
        output.print(`  ${icon} ${r.title} [repo: ${r.repoTarget}] — ${r.durationMs}ms`);
        if (r.noOp) {
          output.print(`    (no modified repo detected — skipped)`);
        }
        if (r.repoResults.length > 1) {
          for (const rr of r.repoResults) {
            const ricon = rr.ok ? "✓" : "✗";
            output.print(`    ${ricon} ${rr.repoName}`);
            if (!rr.ok && rr.stderr) {
              for (const line of rr.stderr.split("\n").slice(0, 8)) {
                output.print(`      | ${line}`);
              }
            }
          }
        } else if (!r.ok && r.stderr) {
          for (const line of r.stderr.split("\n").slice(0, 10)) {
            output.print(`    | ${line}`);
          }
        }
      }
      if (!result.ok) output.print("Stopped at first blocking failure.");
    }
    if (!result.ok) process.exitCode = 1;
  },
});

export const docCommand = command({
  meta: { name: "doc", description: "Doc artifacts (ADR, CONTEXT, glossary, freeform)" },
  subCommands: {
    adr: adrCommand,
    list: listCommand,
    touch: touchCommand,
    profile: profileCommand,
    sync: syncCommand,
    "sync-history": syncHistoryCommand,
    "pre-sync-check": preSyncCheckCommand,
  },
});
