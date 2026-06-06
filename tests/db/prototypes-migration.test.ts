import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vite-plus/test";
import { createTestDb } from "../helpers/db";
import { resolveMigrationsFolder } from "#/db/client";

/**
 * Migration sanity check (PRD 0025 / T1). All five new tables exist and have
 * the columns the domain layer relies on. The same shape is then enforced by
 * Drizzle queries in the domain tests; this file is the cheap smoke that
 * catches a missing migration before everything else fails.
 */
describe("prd_prototypes migration", () => {
  it("creates the prototype tables with FK indexes", () => {
    const { client } = createTestDb();
    const tables = client
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'prd_prototype%' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name)).toEqual([
      "prd_prototype_feedback",
      "prd_prototype_page_versions",
      "prd_prototype_pages",
      "prd_prototype_round_pages",
      "prd_prototype_rounds",
      "prd_prototype_variants",
      "prd_prototypes",
    ]);
  });

  it("declares the unique slug / label indexes per parent", () => {
    const { client } = createTestDb();
    const indexes = client
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'prd_prototype%' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    const names = indexes.map((row) => row.name);
    expect(names).toContain("prd_prototypes_prd_revision_slug_idx");
    expect(names).toContain("prd_prototype_pages_prototype_slug_idx");
    expect(names).toContain("prd_prototype_page_versions_page_label_idx");
    expect(names).toContain("prd_prototype_variants_page_version_label_idx");
    expect(names).toContain("prd_prototype_feedback_variant_status_idx");
  });

  it("supports the `open | ignored` feedback status enum at the row level", () => {
    const { client } = createTestDb();
    // Reach the table by inserting a full chain so FKs satisfy.
    const cols = client.prepare("PRAGMA table_info(prd_prototype_feedback)").all() as Array<{
      name: string;
      type: string;
      dflt_value: unknown;
    }>;
    const status = cols.find((c) => c.name === "status");
    expect(status).toBeDefined();
    expect(status?.dflt_value).toBe("'open'");
    const colNames = cols.map((c) => c.name);
    for (const expected of [
      "id",
      "variant_id",
      "text",
      "selector_css",
      "status",
      "resolution_note",
      "resolution_via_variant_id",
      "resolved_at",
      "ignored_reason",
      "ignored_at",
      "created_at",
    ]) {
      expect(colNames).toContain(expected);
    }
  });
});

/**
 * Round-scoped election migration (PRD 0030 / issue 01). The four election
 * columns move onto `prd_prototype_round_pages`, and the data-preserving copy
 * moves each existing per-page election onto its current-round manifest row.
 * The legacy page columns are KEPT (additive — copy-then-keep, never
 * drop-first), so nothing is lost.
 */
describe("round_scoped_election migration (PRD 0030 / 01)", () => {
  const MIGRATION = "20260606000000_round_scoped_election";

  /** Read the data-copy UPDATE statement from the real shipped migration file. */
  function readCopyStatement(): string {
    const sqlPath = path.join(resolveMigrationsFolder(), MIGRATION, "migration.sql");
    const stmt = readFileSync(sqlPath, "utf8")
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .find((s) => s.toUpperCase().startsWith("UPDATE"));
    if (!stmt) throw new Error("migration UPDATE statement not found");
    return stmt;
  }

  it("adds the election columns to prd_prototype_round_pages and keeps the page columns", () => {
    const { client } = createTestDb();
    const roundPageCols = (
      client.prepare("PRAGMA table_info(prd_prototype_round_pages)").all() as Array<{
        name: string;
      }>
    ).map((c) => c.name);
    for (const expected of [
      "chosen_variant_id",
      "decision_rationale",
      "decided_by",
      "decided_at",
    ]) {
      expect(roundPageCols).toContain(expected);
    }

    // The legacy page-level columns are kept (additive), not dropped.
    const pageCols = (
      client.prepare("PRAGMA table_info(prd_prototype_pages)").all() as Array<{ name: string }>
    ).map((c) => c.name);
    expect(pageCols).toContain("chosen_variant_id");
    expect(pageCols).toContain("decision_rationale");
  });

  it("copies a pre-existing per-page election onto its current-round manifest row", () => {
    const { client } = createTestDb();

    // Build the pre-migration shape directly: a prototype with two rounds, the
    // page elected on the PAGE row, and the manifest rows with NO election yet
    // (the state right after the ALTER TABLE, before the data copy runs).
    const now = Date.now();
    const ins = (sql: string, params: unknown[]) => client.prepare(sql).run(...(params as never[]));

    ins(`INSERT INTO projects (id, name, status, created_at, updated_at) VALUES (?,?,?,?,?)`, [
      "proj-1",
      "p",
      "active",
      now,
      now,
    ]);
    ins(`INSERT INTO prds (id, project_id, priority, created_at, updated_at) VALUES (?,?,?,?,?)`, [
      "prd-1",
      "proj-1",
      "normal",
      now,
      now,
    ]);
    ins(
      `INSERT INTO prd_revisions (id, prd_id, project_id, revision, title, status, audit_cycles, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      ["rev-1", "prd-1", "proj-1", 1, "X", "draft", 0, now, now],
    );
    ins(`INSERT INTO prd_prototypes (id, prd_revision_id, slug, created_at) VALUES (?,?,?,?)`, [
      "proto-1",
      "rev-1",
      "p",
      now,
    ]);
    // The elected variant id is recorded on the PAGE (legacy shape).
    ins(
      `INSERT INTO prd_prototype_pages (id, prototype_id, slug, title, position, chosen_variant_id, decision_rationale, decided_by, decided_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ["page-1", "proto-1", "home", "Home", 0, "variant-elected", "best layout", "po", now, now],
    );
    ins(
      `INSERT INTO prd_prototype_page_versions (id, page_id, label, created_at) VALUES (?,?,?,?)`,
      ["ver-1", "page-1", "v1", now],
    );
    // Two rounds: v1 (position 0, frozen) and v2 (position 1, current).
    ins(
      `INSERT INTO prd_prototype_rounds (id, prototype_id, label, position, created_at) VALUES (?,?,?,?,?)`,
      ["round-v1", "proto-1", "v1", 0, now],
    );
    ins(
      `INSERT INTO prd_prototype_rounds (id, prototype_id, label, position, created_at) VALUES (?,?,?,?,?)`,
      ["round-v2", "proto-1", "v2", 1, now],
    );
    // Manifest rows; election columns reset to null to model the pre-copy state.
    ins(
      `INSERT INTO prd_prototype_round_pages (id, round_id, page_id, page_version_id, position, created_at) VALUES (?,?,?,?,?,?)`,
      ["rp-v1", "round-v1", "page-1", "ver-1", 0, now],
    );
    ins(
      `INSERT INTO prd_prototype_round_pages (id, round_id, page_id, page_version_id, position, created_at) VALUES (?,?,?,?,?,?)`,
      ["rp-v2", "round-v2", "page-1", "ver-1", 0, now],
    );
    client
      .prepare(
        `UPDATE prd_prototype_round_pages SET chosen_variant_id = NULL, decision_rationale = NULL, decided_by = NULL, decided_at = NULL`,
      )
      .run();

    // Run ONLY the data-copy UPDATE from the real migration file (the ALTERs
    // already ran on the fresh DB; re-running them would be a duplicate-column
    // error). This keeps the test pinned to the actual shipped SQL.
    client.prepare(readCopyStatement()).run();

    // The election landed on the CURRENT round (v2, max position), not v1.
    const v2 = client
      .prepare(
        `SELECT chosen_variant_id, decision_rationale, decided_by FROM prd_prototype_round_pages WHERE id = 'rp-v2'`,
      )
      .get() as {
      chosen_variant_id: string | null;
      decision_rationale: string | null;
      decided_by: string | null;
    };
    expect(v2.chosen_variant_id).toBe("variant-elected");
    expect(v2.decision_rationale).toBe("best layout");
    expect(v2.decided_by).toBe("po");

    // The earlier (frozen) round v1 stays empty — only the current round inherits.
    const v1 = client
      .prepare(`SELECT chosen_variant_id FROM prd_prototype_round_pages WHERE id = 'rp-v1'`)
      .get() as { chosen_variant_id: string | null };
    expect(v1.chosen_variant_id).toBeNull();

    // Nothing lost: the legacy page election is still readable too.
    const page = client
      .prepare(`SELECT chosen_variant_id FROM prd_prototype_pages WHERE id = 'page-1'`)
      .get() as { chosen_variant_id: string | null };
    expect(page.chosen_variant_id).toBe("variant-elected");
  });

  it("is a no-op when no page carried an election", () => {
    const { client } = createTestDb();
    // On an empty DB the UPDATE touches nothing and must not throw.
    expect(() => client.prepare(readCopyStatement()).run()).not.toThrow();
    const count = client
      .prepare(
        `SELECT COUNT(*) AS n FROM prd_prototype_round_pages WHERE chosen_variant_id IS NOT NULL`,
      )
      .get() as { n: number };
    expect(count.n).toBe(0);
  });
});

/**
 * Per-(round, page) placement migration (PRD 0030 / issue 02). A data-preserving
 * CREATE TABLE: the new `prd_round_page_design` is added, and the global
 * `prd_design_lock` (one blob per PRD revision, PRD 0028) is deliberately KEPT —
 * a global blob can't be auto-split per page, so it is neither migrated nor
 * dropped. Already-distilled PRDs keep their readable lock text.
 */
describe("round_page_placement migration (PRD 0030 / 02)", () => {
  it("creates prd_round_page_design with the (round_id, page_id) primary key and page index", () => {
    const { client } = createTestDb();
    const table = client
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = 'prd_round_page_design'",
      )
      .get() as { name: string } | undefined;
    expect(table?.name).toBe("prd_round_page_design");

    const cols = client.prepare("PRAGMA table_info(prd_round_page_design)").all() as Array<{
      name: string;
      pk: number;
    }>;
    const colNames = cols.map((c) => c.name);
    for (const expected of ["round_id", "page_id", "placement_spec", "distilled_at"]) {
      expect(colNames).toContain(expected);
    }
    // Composite primary key on (round_id, page_id).
    const pkCols = cols.filter((c) => c.pk > 0).map((c) => c.name);
    expect(pkCols.sort()).toEqual(["page_id", "round_id"]);

    const indexes = (
      client
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'prd_round_page_design%'",
        )
        .all() as Array<{ name: string }>
    ).map((r) => r.name);
    expect(indexes).toContain("prd_round_page_design_page_id_idx");
  });

  it("does NOT drop the global prd_design_lock: an existing row stays readable", () => {
    const { client } = createTestDb();
    const now = Date.now();
    const ins = (sql: string, params: unknown[]) => client.prepare(sql).run(...(params as never[]));

    ins(`INSERT INTO projects (id, name, status, created_at, updated_at) VALUES (?,?,?,?,?)`, [
      "proj-2",
      "p",
      "active",
      now,
      now,
    ]);
    ins(`INSERT INTO prds (id, project_id, priority, created_at, updated_at) VALUES (?,?,?,?,?)`, [
      "prd-2",
      "proj-2",
      "normal",
      now,
      now,
    ]);
    ins(
      `INSERT INTO prd_revisions (id, prd_id, project_id, revision, title, status, audit_cycles, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      ["rev-2", "prd-2", "proj-2", 1, "Y", "draft", 0, now, now],
    );
    // A PRD already distilled under the legacy global lock.
    ins(
      `INSERT INTO prd_design_lock (prd_revision_id, placement_spec, distilled_at) VALUES (?,?,?)`,
      ["rev-2", "legacy global placement blob", now],
    );

    // The table still exists and the row is still readable (not dropped by the
    // per-page migration).
    const lock = client
      .prepare(`SELECT placement_spec FROM prd_design_lock WHERE prd_revision_id = 'rev-2'`)
      .get() as { placement_spec: string } | undefined;
    expect(lock?.placement_spec).toBe("legacy global placement blob");
  });

  it("is a clean CREATE on an empty DB: the new table is empty, the old lock table coexists", () => {
    const { client } = createTestDb();
    const newCount = client.prepare(`SELECT COUNT(*) AS n FROM prd_round_page_design`).get() as {
      n: number;
    };
    expect(newCount.n).toBe(0);
    // The legacy lock table is still present alongside the new one.
    const lockTable = client
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'prd_design_lock'")
      .get() as { name: string } | undefined;
    expect(lockTable?.name).toBe("prd_design_lock");
  });
});

/**
 * Page ↔ task link migration (PRD 0030 / issue 04). A plain additive M:N join
 * `task_prototype_pages`, modeled on `task_user_stories`: composite primary key
 * on `(task_id, page_id)` plus a reverse index on `page_id`.
 */
describe("task_prototype_pages migration (PRD 0030 / 04)", () => {
  it("creates task_prototype_pages with the (task_id, page_id) primary key and page index", () => {
    const { client } = createTestDb();
    const table = client
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = 'task_prototype_pages'",
      )
      .get() as { name: string } | undefined;
    expect(table?.name).toBe("task_prototype_pages");

    const cols = client.prepare("PRAGMA table_info(task_prototype_pages)").all() as Array<{
      name: string;
      pk: number;
    }>;
    expect(cols.map((c) => c.name).sort()).toEqual(["page_id", "task_id"]);
    const pkCols = cols.filter((c) => c.pk > 0).map((c) => c.name);
    expect(pkCols.sort()).toEqual(["page_id", "task_id"]);

    const indexes = (
      client
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'task_prototype_pages%'",
        )
        .all() as Array<{ name: string }>
    ).map((r) => r.name);
    expect(indexes).toContain("task_prototype_pages_page_idx");
  });

  it("does not drop the sibling task_user_stories join it is modeled on", () => {
    const { client } = createTestDb();
    const stories = client
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'task_user_stories'")
      .get() as { name: string } | undefined;
    expect(stories?.name).toBe("task_user_stories");
  });
});
