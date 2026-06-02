import { Effect } from "effect";
import { eq } from "drizzle-orm";
import { docProfiles, docSyncRuns } from "#/db/schema";
import { Db } from "#/services/database";
import { dbQuery } from "#/shared/db";
import { generateId } from "#/shared/utils";
import { DatabaseError, ValidationError } from "#/shared/errors";
import { fetchBase, grepBaseForTicket } from "#/lib/git";

export type DocSource = {
  name: string;
  path: string;
  includeGlobs?: string[];
  excludeGlobs?: string[];
};

export type DocProfileInput = {
  projectId: string;
  name: string;
  targetRoot: string;
  targetPattern?: string;
  sources?: DocSource[];
  language?: string;
  style?: "narrative" | "reference" | "mixed";
  audience?: string;
  routingRules?: Array<{ sourcePathGlob: string; targetDocPath: string; when?: string }>;
  topicsToCover?: string[];
  topicsToIgnore?: string[];
  guardrails?: string[];
  commitPolicy?: "leave-in-working-tree" | "commit-with-message";
};

export const createProfile = (input: DocProfileInput) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const existing = yield* dbQuery(() =>
      db.query.docProfiles.findFirst({
        where: { projectId: input.projectId, name: input.name },
      }),
    );
    if (existing) {
      return yield* Effect.fail(
        new ValidationError({
          reason: `Doc profile '${input.name}' already exists for project '${input.projectId}'`,
        }),
      );
    }
    const rows = yield* dbQuery(() =>
      db
        .insert(docProfiles)
        .values({
          id: generateId(),
          projectId: input.projectId,
          name: input.name,
          targetRoot: input.targetRoot,
          targetPattern: input.targetPattern ?? "**/*.md",
          sources: JSON.stringify(input.sources ?? []),
          language: input.language ?? "en",
          style: input.style ?? "mixed",
          audience: input.audience ?? null,
          routingRules: JSON.stringify(input.routingRules ?? []),
          topicsToCover: JSON.stringify(input.topicsToCover ?? []),
          topicsToIgnore: JSON.stringify(input.topicsToIgnore ?? []),
          guardrails: JSON.stringify(input.guardrails ?? []),
          commitPolicy: input.commitPolicy ?? "leave-in-working-tree",
        })
        .returning(),
    );
    return rows[0]!;
  });

export const updateProfile = (projectId: string, name: string, patch: Partial<DocProfileInput>) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const existing = yield* dbQuery(() =>
      db.query.docProfiles.findFirst({ where: { projectId, name } }),
    );
    if (!existing) {
      return yield* Effect.fail(new ValidationError({ reason: `Doc profile '${name}' not found` }));
    }
    const rows = yield* dbQuery(() =>
      db
        .update(docProfiles)
        .set({
          targetRoot: patch.targetRoot ?? existing.targetRoot,
          targetPattern: patch.targetPattern ?? existing.targetPattern,
          sources: patch.sources ? JSON.stringify(patch.sources) : existing.sources,
          language: patch.language ?? existing.language,
          style: patch.style ?? existing.style,
          audience: patch.audience !== undefined ? patch.audience : existing.audience,
          routingRules: patch.routingRules
            ? JSON.stringify(patch.routingRules)
            : existing.routingRules,
          topicsToCover: patch.topicsToCover
            ? JSON.stringify(patch.topicsToCover)
            : existing.topicsToCover,
          topicsToIgnore: patch.topicsToIgnore
            ? JSON.stringify(patch.topicsToIgnore)
            : existing.topicsToIgnore,
          guardrails: patch.guardrails ? JSON.stringify(patch.guardrails) : existing.guardrails,
          commitPolicy: patch.commitPolicy ?? existing.commitPolicy,
        })
        .where(eq(docProfiles.id, existing.id))
        .returning(),
    );
    return rows[0]!;
  });

export const getProfile = (projectId: string, name: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    return yield* dbQuery(() => db.query.docProfiles.findFirst({ where: { projectId, name } }));
  });

export const listProfiles = (projectId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    return yield* dbQuery(() =>
      db.query.docProfiles.findMany({ where: { projectId }, orderBy: { name: "asc" } }),
    );
  });

export const deleteProfile = (projectId: string, name: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const existing = yield* dbQuery(() =>
      db.query.docProfiles.findFirst({ where: { projectId, name } }),
    );
    if (!existing) return { projectId, name };
    yield* dbQuery(() => db.delete(docProfiles).where(eq(docProfiles.id, existing.id)));
    return { projectId, name };
  });

export const recordSyncRun = (input: {
  profileId: string;
  triggeredByPrdId?: string;
  sinceRef?: string;
  untilRef?: string;
  summary?: string;
  filesChanged?: string[];
}) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const rows = yield* dbQuery(() =>
      db
        .insert(docSyncRuns)
        .values({
          id: generateId(),
          profileId: input.profileId,
          triggeredByPrdId: input.triggeredByPrdId ?? null,
          sinceRef: input.sinceRef ?? null,
          untilRef: input.untilRef ?? null,
          ranAt: new Date(),
          summary: input.summary ?? null,
          filesChanged: JSON.stringify(input.filesChanged ?? []),
        })
        .returning(),
    );
    return rows[0]!;
  });

export const listSyncRuns = (profileId: string, options: { prdId?: string; limit?: number } = {}) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const where = options.prdId ? { profileId, triggeredByPrdId: options.prdId } : { profileId };
    return yield* dbQuery(() =>
      db.query.docSyncRuns.findMany({
        where,
        orderBy: { ranAt: "desc" },
        limit: options.limit,
      }),
    );
  });

/**
 * The single repo a `resolveDiffRange` call resolves a range *for*. doc-sync
 * iterates source repos itself (scope = `prd_repo`) and resolves one range per
 * repo, so the resolver only ever sees one repo at a time. `path` is the repo
 * working tree (where git runs); `baseBranch` is the branch the feature merged
 * into. Absent → ticket-grep is unavailable and the resolver refuses.
 */
export type ResolveRangeRepo = {
  path: string;
  baseBranch: string;
};

export type ResolveRangeInput = {
  profileName: string;
  projectId: string;
  sinceExpr?: string;
  untilExpr?: string;
  /**
   * Ticket-grep inputs (PRD 0023 / T2). All three must be present for the
   * strategy to engage: a configured pattern, a ticket extracted from the PRD,
   * and the repo to grep. Any missing → fall through to the refusal.
   */
  ticketPattern?: string | null;
  ticket?: string | null;
  repo?: ResolveRangeRepo;
};

/**
 * How a source's diff range was resolved.
 *
 * - `"expr"`: the caller passed an explicit `--since` (and optional `--until`),
 *   so the range is taken verbatim.
 * - `"ticket-grep"` (PRD 0023 / T2): the range was derived from the feature's
 *   squash commit(s) by grepping `origin/<base>` for the PRD ticket. `since` is
 *   `<squash>^` and `until` is `<squash>`; with multiple matching commits the
 *   union spans the oldest match's parent to the newest match. The matching
 *   SHA(s) are recorded in `resolvedFrom` for traceability.
 *
 * The resolver is an ordered list of strategies (explicit → ticket-grep →
 * refuse) so a derived mode never reintroduces a silent fallback.
 */
export type ResolvedSourceRange = {
  name: string;
  path: string;
  since: string | null;
  until: string | null;
  mode: "expr" | "ticket-grep";
  /** Squash SHA(s) the ticket-grep range was derived from. */
  resolvedFrom?: string;
};

/**
 * Outcome of resolving a range for one repo.
 *
 * - `resolved`: a usable range (explicit or ticket-grep).
 * - `excluded`: ticket-grep was attempted but the ticket matched no commit in
 *   this repo — a legitimate per-repo outcome (a feature need not touch every
 *   repo in scope), so the repo is dropped from the sync rather than failing
 *   the whole command. The caller surfaces an info line.
 */
export type RepoRangeResolution =
  | { kind: "resolved"; profileId: string; sources: ResolvedSourceRange[] }
  | { kind: "excluded"; profileId: string; ticket: string; base: string };

/**
 * Message surfaced when no strategy can determine the feature's commit range.
 * Refuse-don't-guess: depot never silently invents a range (the old hardcoded
 * `HEAD~20` fallback). The agent is told exactly how to proceed.
 */
export const UNRESOLVED_RANGE_MESSAGE =
  "doc-sync cannot determine the feature's commit range. " +
  "Pass --since <ref> [--until <ref>], or configure a docSyncTicketPattern.";

/**
 * Extract the feature ticket from a PRD using `pattern` (a compilable regex
 * string, e.g. `TICKET-\\d+`). The body is searched first (durable, explicit),
 * preferring an explicit `Refs <ticket>` reference and otherwise the first bare
 * match; the title is the fallback (PRD 0023 / Q2). Returns the matched ticket
 * string or `null`.
 *
 * `suggestedCommitMessage` is deliberately never consulted: it is edited at
 * merge time and its subject diverges from the real squash subject (PRD 0023).
 * An invalid `pattern` is treated as no-match rather than throwing — validation
 * lives at the config layer.
 */
export const extractTicket = (
  prd: { title: string; body: string | null | undefined },
  pattern: string,
): string | null => {
  let ticketRe: RegExp;
  let refsRe: RegExp;
  try {
    ticketRe = new RegExp(pattern);
    refsRe = new RegExp(`Refs\\s+(${pattern})`, "i");
  } catch {
    return null;
  }

  const body = prd.body ?? "";
  const refsMatch = refsRe.exec(body);
  if (refsMatch?.[1]) return refsMatch[1];

  const bodyMatch = ticketRe.exec(body);
  if (bodyMatch?.[0]) return bodyMatch[0];

  const titleMatch = ticketRe.exec(prd.title);
  if (titleMatch?.[0]) return titleMatch[0];

  return null;
};

export const resolveDiffRange = (
  input: ResolveRangeInput,
): Effect.Effect<RepoRangeResolution, ValidationError | DatabaseError, Db> =>
  Effect.gen(function* () {
    const db = yield* Db;
    const profile = yield* dbQuery(() =>
      db.query.docProfiles.findFirst({
        where: { projectId: input.projectId, name: input.profileName },
      }),
    );
    if (!profile) {
      return yield* Effect.fail(
        new ValidationError({ reason: `Doc profile '${input.profileName}' not found` }),
      );
    }

    const sources = JSON.parse(profile.sources) as DocSource[];

    // Strategy 1 — explicit `--since` wins; the range is taken verbatim.
    if (input.sinceExpr) {
      const ranges: ResolvedSourceRange[] = sources.map((source) => ({
        name: source.name,
        path: source.path,
        since: input.sinceExpr!,
        until: input.untilExpr ?? null,
        mode: "expr",
      }));
      return { kind: "resolved", profileId: profile.id, sources: ranges };
    }

    // Strategy 2 — ticket-grep: derive the squash range from the PRD ticket.
    // Engages only with a configured pattern, an extracted ticket, and a repo
    // to grep. fetch is best-effort (Q3); a stale base still greps local.
    if (input.ticketPattern && input.ticket && input.repo) {
      const ticket = input.ticket;
      const base = input.repo.baseBranch;
      yield* fetchBase(input.repo.path, base);
      const shas = yield* grepBaseForTicket(input.repo.path, base, ticket);

      if (shas.length === 0) {
        return { kind: "excluded", profileId: profile.id, ticket, base };
      }

      // `git log` lists newest first; the union spans the oldest match's parent
      // to the newest match.
      const newest = shas[0]!;
      const oldest = shas[shas.length - 1]!;
      const ranges: ResolvedSourceRange[] = sources.map((source) => ({
        name: source.name,
        path: source.path,
        since: `${oldest}^`,
        until: newest,
        mode: "ticket-grep",
        resolvedFrom: shas.join(","),
      }));
      return { kind: "resolved", profileId: profile.id, sources: ranges };
    }

    return yield* Effect.fail(new ValidationError({ reason: UNRESOLVED_RANGE_MESSAGE }));
  });
