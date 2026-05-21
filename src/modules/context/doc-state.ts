import { Effect } from "effect";
import { listProfiles, listSyncRuns } from "#/modules/docs/sync";
import type { DocProfileRow, DocSyncRunRow } from "#/db/schema";

/**
 * Precomputed doc-agent state injected into the `depot context doc` output.
 *
 * `context doc` used to emit only the static doc manual. The doc agent then
 * had to discover the project's doc profiles and the last sync run on its own.
 * This block hands it both up front: the active doc profiles and the most
 * recent `doc_sync_run` per profile.
 */
export type DocProfileState = {
  /** The doc profile. */
  profile: DocProfileRow;
  /** Most recent sync run for this profile, or `null` when never synced. */
  lastRun: DocSyncRunRow | null;
};

/**
 * Resolve the doc-agent state for a project: every doc profile and its most
 * recent sync run. Best-effort — callers degrade to the static manual when
 * resolution fails.
 */
export const resolveDocState = (projectId: string) =>
  Effect.gen(function* () {
    const profiles = yield* listProfiles(projectId).pipe(
      Effect.catchAll(() => Effect.succeed([] as DocProfileRow[])),
    );
    const states: DocProfileState[] = [];
    for (const profile of profiles) {
      const runs = yield* listSyncRuns(profile.id, { limit: 1 }).pipe(
        Effect.catchAll(() => Effect.succeed([] as DocSyncRunRow[])),
      );
      states.push({ profile, lastRun: runs[0] ?? null });
    }
    return states;
  });

/** Render the doc-agent state as a terminal-friendly block. */
export function renderDocState(states: DocProfileState[]): string {
  if (states.length === 0) {
    return "Doc     : (no doc profiles configured — run `depot doc profile create`)";
  }
  const lines: string[] = [`Doc     : ${states.length} doc profile(s)`];
  for (const { profile, lastRun } of states) {
    lines.push(`  - ${profile.name}`);
    lines.push(`      target root : ${profile.targetRoot}`);
    lines.push(`      language    : ${profile.language}  style: ${profile.style}`);
    if (lastRun) {
      const prd = lastRun.triggeredByPrdId ? ` (PRD ${lastRun.triggeredByPrdId})` : "";
      lines.push(`      last sync   : ${lastRun.ranAt.toISOString()}${prd}`);
    } else {
      lines.push("      last sync   : (never synced)");
    }
  }
  return lines.join("\n");
}
