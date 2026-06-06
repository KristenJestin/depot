import { Schema } from "effect";
import { command } from "#/cli/command";
import { getContextTemplate } from "#/modules/context";
import { renderTemplate } from "#/modules/context/renderer";
import { runEffect, resolveCurrentWorkspace } from "#/cli/runtime";
import { getPrd } from "#/modules/prds/domain";
import { listAnnexes } from "#/modules/prds/annexes";
import { listIdeas, listPrdIdeas } from "#/modules/ideas/domain";
import { listPrototypes } from "#/modules/prds/prototypes";
import { resolveRepoShipState, renderRepoShipState } from "#/modules/context/ship-state";
import { resolveDocState, renderDocState } from "#/modules/context/doc-state";
import { listProfiles, listSyncRuns } from "#/modules/docs/sync";
import { log } from "#/shared/logger";

/**
 * Resolve the current `project_repo` for the cwd and render the line printed in
 * the `depot context` header. Best-effort — when the workspace can't be
 * resolved we print nothing rather than aborting; when the workspace exists but
 * no repo matches we tell the agent explicitly. The label keeps a stable shape
 * so an agent can detect both states.
 */
async function renderCurrentRepoLine(): Promise<string | null> {
  try {
    const { currentRepo } = await resolveCurrentWorkspace({
      autoCreate: false,
      throwOnMissing: true,
    });
    if (currentRepo) {
      return `Repo    : ${currentRepo.name}`;
    }
    return "Repo    : (no current repo)";
  } catch {
    return null;
  }
}

/**
 * Whether a doc sync has already run for a given PRD, across all of the
 * project's doc profiles. Best-effort — resolution failures report `false`.
 */
async function docSyncRanForPrd(projectId: string, prdId: string): Promise<boolean> {
  try {
    const profiles = await runEffect(listProfiles(projectId));
    for (const profile of profiles) {
      const runs = await runEffect(listSyncRuns(profile.id, { prdId, limit: 1 }));
      if (runs.length > 0) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Resolve and render the precomputed ship state for `context ship`.
 *
 * Best-effort: the static ship manual is always emitted, so any failure to
 * resolve the workspace, PRD, or repos degrades to a one-line note instead of
 * aborting. The block names the PRD being shipped, tells the ship agent (per
 * repo) which base branch to pull, which worktree to remove, and whether it is
 * clean, and reports whether the doc sync has already run for this PRD.
 */
async function renderShipState(prdTarget: string): Promise<string> {
  try {
    const { ws } = await resolveCurrentWorkspace({ autoCreate: false, throwOnMissing: true });
    if (!prdTarget) {
      return "Repos   : (no PRD specified — pass a PRD id to see per-repo state)";
    }
    const prd = await runEffect(getPrd(prdTarget));
    if (!prd) {
      return `Repos   : (PRD '${prdTarget}' not found — per-repo state unavailable)`;
    }
    const states = await runEffect(resolveRepoShipState(prd.projectId, ws.path, null));
    const docSynced = await docSyncRanForPrd(prd.projectId, prd.id);
    const lines = [
      `Shipping: ${prd.title} (${prd.id}) [${prd.status}]`,
      `Doc sync: ${docSynced ? "already ran for this PRD" : "not yet run for this PRD"}`,
      renderRepoShipState(states),
    ];
    return lines.join("\n");
  } catch {
    return "Repos   : (per-repo state unavailable — could not resolve the workspace)";
  }
}

/**
 * Resolve and render the "Annexes" list for the PRD embedded in the context
 * header (PRD 0024 / T1). Lists `name (kind) — description` only, never the
 * content — the agent runs `depot prd annex cat <id>` on demand to keep the
 * initial context lean. Best-effort: any resolution failure yields `null` so
 * the universal contract template still prints.
 */
async function renderAnnexesSection(prdTarget: string): Promise<string | null> {
  if (!prdTarget) return null;
  try {
    const prd = await runEffect(getPrd(prdTarget));
    if (!prd) return null;
    const annexes = await runEffect(listAnnexes(prd.id));
    if (annexes.length === 0) return null;
    const lines = ["Annexes :"];
    for (const annex of annexes) {
      const desc = annex.description ? ` — ${annex.description}` : "";
      lines.push(`  - ${annex.name} (${annex.kind})${desc}  [${annex.id}]`);
    }
    lines.push("  (read full content with: depot prd annex cat <annex-id>)");
    return lines.join("\n");
  } catch {
    return null;
  }
}

/**
 * Render the open-idea recall row (`Ideas   : N open`) embedded in the
 * `context prd` header (PRD 0027). Surfaces the backlog count where product
 * framing happens so "don't forget" actually works. Returns `null` when the
 * workspace cannot be resolved OR when there are zero open ideas (the row is
 * omitted at zero). `prd` mode only — never rendered for dev/coder/auditor.
 */
async function renderOpenIdeaCountRow(): Promise<string | null> {
  try {
    const { ws } = await resolveCurrentWorkspace({ autoCreate: false, throwOnMissing: true });
    const open = await runEffect(listIdeas(ws.projectId, { status: "open" }));
    if (open.length === 0) return null;
    return `Ideas   : ${open.length} open`;
  } catch {
    return null;
  }
}

/**
 * Render the "Source ideas" section for the PRD embedded in the `context prd`
 * header (PRD 0027). Lists each linked source idea's title + FULL body verbatim
 * so the PRD agent reads the raw, uncommitted need before grilling. Ideas are
 * short by construction, so the full body is inlined (unlike annexes, which are
 * read on demand). Best-effort: any resolution failure — or a PRD with no
 * linked ideas — yields `null` so nothing is rendered. `prd` mode only.
 */
async function renderSourceIdeasSection(prdTarget: string): Promise<string | null> {
  if (!prdTarget) return null;
  try {
    const linked = await runEffect(listPrdIdeas(prdTarget));
    if (linked.length === 0) return null;
    const lines = ["## Source ideas", ""];
    lines.push("The raw, uncommitted needs that motivated this PRD. Read them before framing.");
    for (const idea of linked) {
      lines.push("");
      const tag = idea.tag ? ` [${idea.tag}]` : "";
      lines.push(`### ${idea.title}${tag}`);
      lines.push(`(idea ${idea.id})`);
      if (idea.body) {
        lines.push("");
        lines.push(idea.body);
      }
    }
    return lines.join("\n");
  } catch {
    return null;
  }
}

/**
 * Pass the resolved static template body through `renderTemplate`, which
 * substitutes `{{directives …}}` / `{{hooks …}}` markers with the project's
 * current directives. The renderer is best-effort: any failure (workspace not
 * found, DB error, etc.) degrades to the raw template plus a one-line warning
 * on stderr — the agent's access to the universal contract is more important
 * than a clean substitution.
 */
async function renderTemplateWithFallback(template: string): Promise<string> {
  try {
    const { ws } = await resolveCurrentWorkspace({ autoCreate: false, throwOnMissing: true });
    return await runEffect(renderTemplate(template, ws.projectId));
  } catch (e: unknown) {
    const reason = e instanceof Error ? e.message : String(e);
    log.error(`Warning: renderer failed, emitting raw template (${reason})`);
    return template;
  }
}

/**
 * Resolve and render the precomputed doc state for `context doc`: the active
 * doc profiles and the last `doc_sync_run` per profile. Best-effort — degrades
 * to a one-line note when the workspace cannot be resolved.
 */
async function renderDocContextState(): Promise<string> {
  try {
    const { ws } = await resolveCurrentWorkspace({ autoCreate: false, throwOnMissing: true });
    const states = await runEffect(resolveDocState(ws.projectId));
    return renderDocState(states);
  } catch {
    return "Doc     : (doc state unavailable — could not resolve the workspace)";
  }
}

export const contextCommand = command({
  meta: { name: "context", description: "Emit static agent context for the current workspace" },
  args: {
    mode: {
      schema: Schema.Literal("prd", "dev", "coder", "auditor", "doc", "ship", "prototype", "idea"),
      positional: true,
      description: "Context mode (prd/dev/coder/auditor/doc/ship/prototype/idea)",
    },
    prdTarget: {
      schema: Schema.String,
      positional: true,
      default: "",
      description: "PRD ID or title to embed in the header (dev/coder/auditor/ship/prototype mode)",
    },
    review: {
      schema: Schema.String,
      description: "Review ID to embed in the header (coder mode only)",
    },
    axis: {
      schema: Schema.Literal("standards", "spec"),
      description:
        "Auditor axis (auditor mode only). Required: the dev orchestrator spawns one auditor per axis.",
    },
    prototype: {
      schema: Schema.String,
      description:
        "Prototype slug (prototype mode only). Optional when the PRD has exactly one prototype.",
    },
  },
  run: async ({ args, output }) => {
    if (output.isJson()) {
      output.error(
        "unsupported",
        "The context command does not support --json output in this version.",
      );
    }

    const mode = args.mode;

    if (mode === "auditor" && !args.axis) {
      return output.error(
        "missing_axis",
        "depot context auditor requires --axis standards|spec. The dev orchestrator spawns one auditor per axis in parallel.",
      );
    }

    const lines: string[] = [];

    const modeLabel = mode ? mode.toUpperCase() : "CONTEXT";
    const axisLabel = args.axis ? ` (${args.axis.toUpperCase()})` : "";
    lines.push(`=== DEPOT CONTEXT — ${modeLabel}${axisLabel} ===`);

    const currentRepoLine = await renderCurrentRepoLine();
    if (currentRepoLine) {
      lines.push(currentRepoLine);
    }

    if (args.prdTarget) {
      lines.push(`PRD     : ${args.prdTarget}`);
    }

    if (args.review) {
      lines.push(`Review  : ${args.review}`);
    }

    if (args.axis) {
      lines.push(`Axis    : ${args.axis}`);
    }

    // Recall row (PRD 0027): surface the open-idea backlog count where product
    // framing happens. `prd` mode ONLY — dev/coder/auditor must not see it.
    const openIdeaCountRow = mode === "prd" ? await renderOpenIdeaCountRow() : null;
    if (openIdeaCountRow) {
      lines.push(openIdeaCountRow);
    }

    if (mode === "ship") {
      lines.push(await renderShipState(args.prdTarget ?? ""));
    }

    if (mode === "doc") {
      lines.push(await renderDocContextState());
    }

    const annexesSection = await renderAnnexesSection(args.prdTarget ?? "");
    if (annexesSection) {
      lines.push(annexesSection);
    }

    // Source ideas (PRD 0027): the raw needs that motivated this PRD, rendered
    // full-body. `prd` mode ONLY — never leaked into dev/coder/auditor.
    const sourceIdeasSection =
      mode === "prd" ? await renderSourceIdeasSection(args.prdTarget ?? "") : null;
    if (sourceIdeasSection) {
      lines.push(sourceIdeasSection);
    }

    if (
      currentRepoLine ||
      args.prdTarget ||
      args.review ||
      args.axis ||
      openIdeaCountRow ||
      mode === "ship" ||
      mode === "doc" ||
      annexesSection ||
      sourceIdeasSection
    ) {
      lines.push("");
    }

    if (mode) {
      let template = getContextTemplate(mode);
      // Prototype mode: resolve the prototype id from the PRD + slug and
      // patch the `{{prototype_state prototypeId=<id>}}` marker before the
      // generic renderer runs over the template. Fail loud rather than
      // letting the marker pass through with a literal `<id>` placeholder.
      if (mode === "prototype") {
        const prdRef = args.prdTarget ?? "";
        if (!prdRef) {
          return output.error(
            "missing_prd",
            "depot context prototype requires a PRD revision id positional argument.",
          );
        }
        try {
          const prd = await runEffect(getPrd(prdRef));
          if (!prd) {
            return output.error("not_found", `PRD not found: ${prdRef}`);
          }
          const protos = await runEffect(listPrototypes(prd.id));
          if (protos.length === 0) {
            // No prototype yet — `context prototype` is the documented entry
            // point, so emit the sub-agent context anyway and turn the state
            // marker into a "create one first" instruction. The sub-agent's
            // "Persisting your work" section documents `prd prototype create`.
            template = template.replace(
              /\{\{prototype_state prototypeId=<id>\}\}/g,
              `No prototype exists yet for this PRD. Create one as your first step:\n\n\`\`\`\ndepot prd prototype create ${prdRef} <slug>\n\`\`\``,
            );
          } else {
            const wanted = args.prototype;
            let chosen = protos[0]!;
            if (wanted) {
              const found = protos.find((p) => p.slug === wanted);
              if (!found) {
                return output.error(
                  "no_prototype",
                  `PRD ${prdRef} has no prototype slug '${wanted}'. Available: ${protos.map((p) => p.slug).join(", ")}.`,
                );
              }
              chosen = found;
            } else if (protos.length > 1) {
              return output.error(
                "ambiguous_prototype",
                `PRD ${prdRef} has ${protos.length} prototypes; pass --prototype <slug>. Available: ${protos.map((p) => p.slug).join(", ")}.`,
              );
            }
            template = template.replace(
              /\{\{prototype_state prototypeId=<id>\}\}/g,
              `{{prototype_state prototypeId=${chosen.id}}}`,
            );
          }
        } catch (e) {
          log.error(
            `Warning: could not resolve prototype context (${e instanceof Error ? e.message : String(e)})`,
          );
        }
      }
      lines.push(await renderTemplateWithFallback(template));
    }

    output.print(lines.join("\n"));
  },
});
