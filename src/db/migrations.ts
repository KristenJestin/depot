// Import migration SQL files as text.
// At runtime (bun), `with { type: "text" }` handles loading natively.
// In vitest, the rawMdPlugin in vitest.config.ts handles .sql files by extension.
import migration0 from "./migrations/20260420161744_woozy_marauders/migration.sql" with {
  type: "text",
};

// ── Migration definition ──────────────────────────────────────────────────────

export interface Migration {
  /** Unique name matching the migration directory (used as primary key in tracking table). */
  name: string;
  /** Idempotent SQL statements to execute. */
  statements: string[];
}

/**
 * Patch a drizzle-kit migration SQL string to be idempotent.
 * drizzle-kit generates `CREATE TABLE` — we rewrite to `CREATE TABLE IF NOT EXISTS`.
 * Statements are split on the drizzle-kit statement-breakpoint marker.
 */
function makeIdempotent(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^CREATE TABLE /gm, "CREATE TABLE IF NOT EXISTS "));
}

// ── Ordered migration list ────────────────────────────────────────────────────
// Add new migrations here in chronological order as they are generated.

export const MIGRATIONS: Migration[] = [
  {
    name: "20260420161744_woozy_marauders",
    statements: makeIdempotent(migration0),
  },
];
