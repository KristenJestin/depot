import { Effect } from "effect";
import { eq } from "drizzle-orm";
import { projects } from "#/db/schema";
import { generateId } from "#/shared/utils";
import type { ProjectStatus } from "#/shared/validator";
import { Db } from "#/services/database";
import { ProjectNotFoundError } from "#/shared/errors";
import { dbQuery } from "#/shared/db";

// ── Functions ─────────────────────────────────────────────────────────────────

export const createProject = (input: { name: string; description?: string }) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const id = generateId();
    const rows = yield* dbQuery(() =>
      db
        .insert(projects)
        .values({
          id,
          name: input.name,
          description: input.description ?? null,
          status: "active",
        })
        .returning(),
    );
    return rows[0]!;
  });

export const listProjects = () =>
  Effect.gen(function* () {
    const db = yield* Db;
    return yield* dbQuery(() => db.query.projects.findMany({ orderBy: { createdAt: "asc" } }));
  });

export const getProject = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const row = yield* dbQuery(() => db.query.projects.findFirst({ where: { id } }));
    return row ?? null;
  });

export const updateProject = (
  id: string,
  changes: { name?: string; description?: string; status?: ProjectStatus },
) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const project = yield* getProject(id);
    if (!project) return yield* Effect.fail(new ProjectNotFoundError({ id }));
    const rows = yield* dbQuery(() =>
      db
        .update(projects)
        .set({
          ...(changes.name !== undefined ? { name: changes.name } : {}),
          ...(changes.description !== undefined ? { description: changes.description } : {}),
          ...(changes.status !== undefined ? { status: changes.status } : {}),
        })
        .where(eq(projects.id, id))
        .returning(),
    );
    return rows[0]!;
  });
