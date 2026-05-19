import { Effect } from "effect";
import { eq } from "drizzle-orm";
import { outOfScopeItems } from "#/db/schema";
import { Db } from "#/services/database";
import { dbQuery } from "#/shared/db";
import { generateId } from "#/shared/utils";
import { PrdNotFoundError, ProjectNotFoundError, ValidationError } from "#/shared/errors";

export const addOutOfScope = (input: {
  projectId: string;
  prdRevisionId?: string;
  title: string;
  reason: string;
  decidedBy?: string;
  linkedReviewTaskId?: string;
}) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const project = yield* dbQuery(() =>
      db.query.projects.findFirst({ where: { id: input.projectId } }),
    );
    if (!project) {
      return yield* Effect.fail(new ProjectNotFoundError({ id: input.projectId }));
    }
    if (input.prdRevisionId) {
      const rev = yield* dbQuery(() =>
        db.query.prdRevisions.findFirst({ where: { id: input.prdRevisionId } }),
      );
      if (!rev) {
        return yield* Effect.fail(new PrdNotFoundError({ id: input.prdRevisionId }));
      }
      if (rev.projectId !== input.projectId) {
        return yield* Effect.fail(
          new ValidationError({
            reason: `PRD '${input.prdRevisionId}' does not belong to project '${input.projectId}'`,
          }),
        );
      }
    }
    const rows = yield* dbQuery(() =>
      db
        .insert(outOfScopeItems)
        .values({
          id: generateId(),
          projectId: input.projectId,
          prdRevisionId: input.prdRevisionId ?? null,
          title: input.title,
          reason: input.reason,
          decidedAt: new Date(),
          decidedBy: input.decidedBy ?? null,
          linkedReviewTaskId: input.linkedReviewTaskId ?? null,
        })
        .returning(),
    );
    return rows[0]!;
  });

export const listOutOfScope = (filter: { projectId: string; prdRevisionId?: string }) =>
  Effect.gen(function* () {
    const db = yield* Db;
    if (filter.prdRevisionId) {
      return yield* dbQuery(() =>
        db.query.outOfScopeItems.findMany({
          where: { projectId: filter.projectId, prdRevisionId: filter.prdRevisionId },
          orderBy: { createdAt: "desc" },
        }),
      );
    }
    return yield* dbQuery(() =>
      db.query.outOfScopeItems.findMany({
        where: { projectId: filter.projectId },
        orderBy: { createdAt: "desc" },
      }),
    );
  });

export const removeOutOfScope = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    yield* dbQuery(() => db.delete(outOfScopeItems).where(eq(outOfScopeItems.id, id)));
    return id;
  });
