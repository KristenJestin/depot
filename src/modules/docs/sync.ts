import { Effect } from "effect";
import { eq } from "drizzle-orm";
import { docProfiles, docSyncRuns } from "#/db/schema";
import { Db } from "#/services/database";
import { dbQuery } from "#/shared/db";
import { generateId } from "#/shared/utils";
import { ValidationError } from "#/shared/errors";

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

export type ResolveRangeInput = {
  profileName: string;
  projectId: string;
  prdRevisionId?: string;
  sinceExpr?: string;
  untilExpr?: string;
};

export type ResolvedSourceRange = {
  name: string;
  path: string;
  since: string | null;
  until: string | null;
  mode: "sha" | "time-window" | "expr";
};

export const resolveDiffRange = (input: ResolveRangeInput) =>
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
    const ranges: ResolvedSourceRange[] = [];

    let prdRev: { activatedAtSha: string | null; doneAtSha: string | null } | null = null;
    if (input.prdRevisionId) {
      prdRev = yield* dbQuery(() =>
        db.query.prdRevisions.findFirst({ where: { id: input.prdRevisionId } }),
      ).pipe(
        Effect.map((r) =>
          r ? { activatedAtSha: r.activatedAtSha, doneAtSha: r.doneAtSha } : null,
        ),
      );
    }

    for (const source of sources) {
      if (input.sinceExpr) {
        ranges.push({
          name: source.name,
          path: source.path,
          since: input.sinceExpr,
          until: input.untilExpr ?? null,
          mode: "expr",
        });
      } else if (prdRev?.activatedAtSha) {
        ranges.push({
          name: source.name,
          path: source.path,
          since: prdRev.activatedAtSha,
          until: prdRev.doneAtSha,
          mode: "sha",
        });
      } else {
        ranges.push({
          name: source.name,
          path: source.path,
          since: "HEAD~20",
          until: null,
          mode: "time-window",
        });
      }
    }

    return { profileId: profile.id, sources: ranges };
  });
