/**
 * Type shims for drizzle-orm/node-sqlite and drizzle-orm/node-sqlite/migrator.
 * These modules are expected to be released in a future drizzle-orm version
 * that provides first-class support for Node's built-in node:sqlite (DatabaseSync).
 * Remove this file once drizzle-orm ships the real implementation.
 */
declare module "drizzle-orm/node-sqlite" {
  import type { DatabaseSync } from "node:sqlite";
  import type { DrizzleConfig } from "drizzle-orm";
  import type { AnyRelations, EmptyRelations } from "drizzle-orm/relations";
  import { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

  export type NodeSQLiteDatabase<
    TSchema extends Record<string, unknown> = Record<string, never>,
    TRelations extends AnyRelations = EmptyRelations,
  > = BaseSQLiteDatabase<"sync", void, TSchema, TRelations>;

  export function drizzle<
    TSchema extends Record<string, unknown> = Record<string, never>,
    TRelations extends AnyRelations = EmptyRelations,
    TClient extends DatabaseSync = DatabaseSync,
  >(
    config: DrizzleConfig<TSchema, TRelations> & { client: TClient },
  ): NodeSQLiteDatabase<TSchema, TRelations> & { $client: TClient };
}

declare module "drizzle-orm/node-sqlite/migrator" {
  import type { MigrationConfig } from "drizzle-orm/migrator";
  export function migrate(db: unknown, config: MigrationConfig): void;
}
