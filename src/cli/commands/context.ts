import { Schema } from "effect";
import { command } from "#/cli/command";
import { getContextTemplate } from "#/modules/context";
import { renderTemplate } from "#/modules/context/renderer";
import { runEffect, resolveCurrentWorkspace } from "#/cli/runtime";
import { getPrd } from "#/modules/prds/domain";
import { listAnnexes } from "#/modules/prds/annexes";
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
      schema: Schema.Literal("prd", "dev", "coder", "auditor", "doc", "ship"),
      positional: true,
      description: "Context mode (prd/dev/coder/auditor/doc/ship)",
    },
    prdTarget: {
      schema: Schema.String,
      positional: true,
      default: "",
      description: "PRD ID or title to embed in the header (dev/coder/auditor/ship mode)",
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

    if (
      currentRepoLine ||
      args.prdTarget ||
      args.review ||
      args.axis ||
      mode === "ship" ||
      mode === "doc" ||
      annexesSection
    ) {
      lines.push("");
    }

    if (mode) {
      const template = getContextTemplate(mode);
      lines.push(await renderTemplateWithFallback(template));
    }

    output.print(lines.join("\n"));
  },
});
