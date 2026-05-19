import { Effect } from "effect";
import { eq, and, max, sql } from "drizzle-orm";
import { docArtifacts } from "#/db/schema";
import { Db } from "#/services/database";
import { dbQuery } from "#/shared/db";
import { generateId } from "#/shared/utils";
import { ProjectNotFoundError, ValidationError } from "#/shared/errors";
import type { ActivitySource, AdrStatus, DocKind } from "#/shared/validator";

export const nextAdrNumber = (projectId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const rows = yield* dbQuery(() =>
      db
        .select({ maxNum: max(docArtifacts.number) })
        .from(docArtifacts)
        .where(and(eq(docArtifacts.projectId, projectId), eq(docArtifacts.kind, "adr"))!),
    );
    const current = rows[0]?.maxNum ?? 0;
    return current + 1;
  });

export const registerDocArtifact = (input: {
  projectId: string;
  workspaceId?: string;
  kind: DocKind;
  path: string;
  number?: number;
  title: string;
  status?: AdrStatus;
  linkedPrdRevisionId?: string;
  source?: ActivitySource;
}) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const project = yield* dbQuery(() =>
      db.query.projects.findFirst({ where: { id: input.projectId } }),
    );
    if (!project) {
      return yield* Effect.fail(new ProjectNotFoundError({ id: input.projectId }));
    }

    const existing = yield* dbQuery(() =>
      db.query.docArtifacts.findFirst({
        where: { projectId: input.projectId, path: input.path },
      }),
    );

    if (existing) {
      const rows = yield* dbQuery(() =>
        db
          .update(docArtifacts)
          .set({
            kind: input.kind,
            number: input.number ?? existing.number,
            title: input.title,
            status: input.status ?? existing.status,
            linkedPrdRevisionId: input.linkedPrdRevisionId ?? existing.linkedPrdRevisionId,
            workspaceId: input.workspaceId ?? existing.workspaceId,
            lastModifiedAt: new Date(),
            lastModifiedBySource: input.source ?? "ai",
          })
          .where(eq(docArtifacts.id, existing.id))
          .returning(),
      );
      return rows[0]!;
    }

    const rows = yield* dbQuery(() =>
      db
        .insert(docArtifacts)
        .values({
          id: generateId(),
          projectId: input.projectId,
          workspaceId: input.workspaceId ?? null,
          kind: input.kind,
          path: input.path,
          number: input.number ?? null,
          title: input.title,
          status: input.status ?? null,
          supersededBy: null,
          linkedPrdRevisionId: input.linkedPrdRevisionId ?? null,
          lastModifiedAt: new Date(),
          lastModifiedBySource: input.source ?? "ai",
        })
        .returning(),
    );
    return rows[0]!;
  });

export const touchDocArtifact = (id: string, source: ActivitySource = "ai") =>
  Effect.gen(function* () {
    const db = yield* Db;
    const rows = yield* dbQuery(() =>
      db
        .update(docArtifacts)
        .set({ lastModifiedAt: new Date(), lastModifiedBySource: source })
        .where(eq(docArtifacts.id, id))
        .returning(),
    );
    if (rows.length === 0) {
      return yield* Effect.fail(new ValidationError({ reason: `Doc artifact not found: ${id}` }));
    }
    return rows[0]!;
  });

export const supersedeAdr = (projectId: string, oldNumber: number, byNumber: number) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const old = yield* dbQuery(() =>
      db.query.docArtifacts.findFirst({
        where: { projectId, kind: "adr", number: oldNumber },
      }),
    );
    if (!old) {
      return yield* Effect.fail(
        new ValidationError({ reason: `ADR #${oldNumber} not found in project ${projectId}` }),
      );
    }
    const by = yield* dbQuery(() =>
      db.query.docArtifacts.findFirst({
        where: { projectId, kind: "adr", number: byNumber },
      }),
    );
    if (!by) {
      return yield* Effect.fail(
        new ValidationError({
          reason: `Superseding ADR #${byNumber} not found in project ${projectId}`,
        }),
      );
    }
    const rows = yield* dbQuery(() =>
      db
        .update(docArtifacts)
        .set({ status: "superseded", supersededBy: by.id })
        .where(eq(docArtifacts.id, old.id))
        .returning(),
    );
    return rows[0]!;
  });

export const listDocArtifacts = (projectId: string, filter: { kind?: DocKind } = {}) =>
  Effect.gen(function* () {
    const db = yield* Db;
    if (filter.kind) {
      return yield* dbQuery(() =>
        db.query.docArtifacts.findMany({
          where: { projectId, kind: filter.kind },
          orderBy: { number: "asc" },
        }),
      );
    }
    return yield* dbQuery(() =>
      db.query.docArtifacts.findMany({
        where: { projectId },
        orderBy: { createdAt: "asc" },
      }),
    );
  });

export const linkDocToPrd = (docId: string, prdRevisionId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const rows = yield* dbQuery(() =>
      db
        .update(docArtifacts)
        .set({ linkedPrdRevisionId: prdRevisionId })
        .where(eq(docArtifacts.id, docId))
        .returning(),
    );
    if (rows.length === 0) {
      return yield* Effect.fail(
        new ValidationError({ reason: `Doc artifact not found: ${docId}` }),
      );
    }
    return rows[0]!;
  });

// Re-export the `sql` helper symbol to suppress unused warnings; left here
// for future use (e.g. case-insensitive path lookups via `LOWER(path)`).
void sql;
