import { Effect } from "effect";
import { and, eq } from "drizzle-orm";
import { projectConfig } from "#/db/schema";
import { Db } from "#/services/database";
import { dbQuery } from "#/shared/db";
import type { ActivitySource } from "#/shared/validator";

const KNOWN_KEYS = new Set([
  "baseBranch",
  "defaultDocProfile",
  "docSyncTicketPattern",
  "defaultEditor",
]);

export const setConfig = (
  projectId: string,
  key: string,
  value: string,
  source: ActivitySource = "human",
) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const existing = yield* dbQuery(() =>
      db.query.projectConfig.findFirst({ where: { projectId, key } }),
    );
    if (existing) {
      const rows = yield* dbQuery(() =>
        db
          .update(projectConfig)
          .set({ value, updatedBySource: source })
          .where(and(eq(projectConfig.projectId, projectId), eq(projectConfig.key, key))!)
          .returning(),
      );
      return rows[0]!;
    }
    const rows = yield* dbQuery(() =>
      db
        .insert(projectConfig)
        .values({ projectId, key, value, updatedBySource: source })
        .returning(),
    );
    return rows[0]!;
  });

export const getConfig = (projectId: string, key: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    return yield* dbQuery(() => db.query.projectConfig.findFirst({ where: { projectId, key } }));
  });

export const listConfig = (projectId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    return yield* dbQuery(() =>
      db.query.projectConfig.findMany({ where: { projectId }, orderBy: { key: "asc" } }),
    );
  });

export const unsetConfig = (projectId: string, key: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    yield* dbQuery(() =>
      db
        .delete(projectConfig)
        .where(and(eq(projectConfig.projectId, projectId), eq(projectConfig.key, key))!),
    );
    return { projectId, key };
  });

export const isKnownKey = (key: string): boolean => KNOWN_KEYS.has(key);
