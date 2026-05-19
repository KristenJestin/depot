import { Effect } from "effect";
import { eq, and } from "drizzle-orm";
import { userStories, taskUserStories } from "#/db/schema";
import { Db } from "#/services/database";
import { dbQuery } from "#/shared/db";
import { generateId } from "#/shared/utils";
import { PrdNotFoundError, TaskNotFoundError, ValidationError } from "#/shared/errors";
import { assertTaskInPrd } from "#/lib/cross-entity";

export const createUserStory = (input: {
  prdRevisionId: string;
  asRole: string;
  want: string;
  so: string;
  notes?: string;
  position?: number;
}) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const rev = yield* dbQuery(() =>
      db.query.prdRevisions.findFirst({ where: { id: input.prdRevisionId } }),
    );
    if (!rev) return yield* Effect.fail(new PrdNotFoundError({ id: input.prdRevisionId }));

    const existing = yield* dbQuery(() =>
      db.query.userStories.findMany({ where: { prdRevisionId: input.prdRevisionId } }),
    );
    const position = input.position ?? existing.length + 1;

    const rows = yield* dbQuery(() =>
      db
        .insert(userStories)
        .values({
          id: generateId(),
          prdRevisionId: input.prdRevisionId,
          position,
          asRole: input.asRole,
          want: input.want,
          so: input.so,
          notes: input.notes ?? null,
        })
        .returning(),
    );
    return rows[0]!;
  });

export const listUserStories = (prdRevisionId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    return yield* dbQuery(() =>
      db.query.userStories.findMany({
        where: { prdRevisionId },
        orderBy: { position: "asc" },
      }),
    );
  });

export const updateUserStory = (
  id: string,
  changes: { asRole?: string; want?: string; so?: string; notes?: string | null },
) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const existing = yield* dbQuery(() => db.query.userStories.findFirst({ where: { id } }));
    if (!existing) {
      return yield* Effect.fail(new ValidationError({ reason: `User story not found: ${id}` }));
    }
    const rows = yield* dbQuery(() =>
      db
        .update(userStories)
        .set({
          asRole: changes.asRole ?? existing.asRole,
          want: changes.want ?? existing.want,
          so: changes.so ?? existing.so,
          notes: changes.notes !== undefined ? changes.notes : existing.notes,
        })
        .where(eq(userStories.id, id))
        .returning(),
    );
    return rows[0]!;
  });

export const removeUserStory = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    yield* dbQuery(() => db.delete(taskUserStories).where(eq(taskUserStories.userStoryId, id)));
    yield* dbQuery(() => db.delete(userStories).where(eq(userStories.id, id)));
    return id;
  });

export const linkStoryToTask = (storyId: string, taskId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const story = yield* dbQuery(() => db.query.userStories.findFirst({ where: { id: storyId } }));
    if (!story) {
      return yield* Effect.fail(
        new ValidationError({ reason: `User story not found: ${storyId}` }),
      );
    }
    yield* assertTaskInPrd(taskId, story.prdRevisionId);

    const existing = yield* dbQuery(() =>
      db.query.taskUserStories.findFirst({ where: { taskId, userStoryId: storyId } }),
    );
    if (existing) return existing;

    const rows = yield* dbQuery(() =>
      db.insert(taskUserStories).values({ taskId, userStoryId: storyId }).returning(),
    );
    return rows[0]!;
  });

export const unlinkStoryFromTask = (storyId: string, taskId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    yield* dbQuery(() =>
      db
        .delete(taskUserStories)
        .where(and(eq(taskUserStories.userStoryId, storyId), eq(taskUserStories.taskId, taskId))!),
    );
    return { storyId, taskId };
  });

export const listStoriesForTask = (taskId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const links = yield* dbQuery(() => db.query.taskUserStories.findMany({ where: { taskId } }));
    if (links.length === 0) return [];
    const stories = yield* dbQuery(() =>
      db.query.userStories.findMany({
        where: { id: { in: links.map((l) => l.userStoryId) } },
      }),
    );
    return stories;
  });

export const listTasksForStory = (storyId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const links = yield* dbQuery(() =>
      db.query.taskUserStories.findMany({ where: { userStoryId: storyId } }),
    );
    if (links.length === 0) return [];
    const tasks = yield* dbQuery(() =>
      db.query.tasks.findMany({ where: { id: { in: links.map((l) => l.taskId) } } }),
    );
    if (tasks.length !== links.length) {
      return yield* Effect.fail(new TaskNotFoundError({ id: "unknown" }));
    }
    return tasks;
  });
