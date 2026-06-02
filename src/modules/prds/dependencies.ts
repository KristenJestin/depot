import { Effect } from "effect";
import { and, eq } from "drizzle-orm";
import { prdDependsOn, type PrdDependsOnRow, type PrdRow } from "#/db/schema";
import { Db } from "#/services/database";
import { dbQuery } from "#/shared/db";
import { PrdNotFoundError, ValidationError } from "#/shared/errors";

/**
 * PRD ↔ PRD dependency graph (DAG) — PRD 0019 / T2.
 *
 * Edges live in `prd_depends_on` (`prd_id`, `depends_on_prd_id`) — both columns
 * reference the logical `prds` row so a dependency declared on revision r1
 * still applies after a fork to r2. Acyclicity is enforced at insert time via
 * DFS in `addDependency`; the trivial A→A edge is also refused by a SQL CHECK
 * constraint on the table.
 *
 * All inputs are logical PRD ids (`prds.id`), matching the storage shape. The
 * CLI layer accepts the user-facing revision id and resolves it to the logical
 * PRD id before calling these functions.
 */

/** Look up a logical PRD by id. Returns `null` if no row matches. */
const findPrd = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const row = yield* dbQuery(() => db.query.prds.findFirst({ where: { id } }));
    return row ?? null;
  });

const findEdge = (prdId: string, dependsOnPrdId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const row = yield* dbQuery(() =>
      db.query.prdDependsOn.findFirst({ where: { prdId, dependsOnPrdId } }),
    );
    return row ?? null;
  });

/**
 * Walk the dependency chain from `startId` and return a path that ends on
 * `targetId` if one exists, otherwise `null`. The returned path starts at
 * `startId` and ends at `targetId`. Used by `addDependency` to surface the
 * cycle that the proposed edge would close.
 */
const findPath = (startId: string, targetId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const allEdges = yield* dbQuery(() => db.query.prdDependsOn.findMany());
    const adj = new Map<string, string[]>();
    for (const edge of allEdges) {
      const list = adj.get(edge.prdId) ?? [];
      list.push(edge.dependsOnPrdId);
      adj.set(edge.prdId, list);
    }

    const stack: string[] = [];
    const visited = new Set<string>();

    function dfs(node: string): string[] | null {
      if (visited.has(node)) return null;
      visited.add(node);
      stack.push(node);
      if (node === targetId) return [...stack];
      for (const next of adj.get(node) ?? []) {
        const result = dfs(next);
        if (result) return result;
      }
      stack.pop();
      return null;
    }

    return dfs(startId);
  });

/**
 * Declare that `prdId` depends on `dependsOnPrdId`.
 *
 * Validates that both logical PRDs exist and belong to the same project. The
 * trivial self-dependency is refused (also enforced at SQL via CHECK). Before
 * the insert, runs a DFS from `dependsOnPrdId` walking forward through the
 * existing graph; if `prdId` is reachable, the new edge would close a cycle
 * and the call is refused with a message that lists the offending path.
 * Idempotent: a second call with the same pair returns the existing edge.
 */
export const addDependency = (prdId: string, dependsOnPrdId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;

    if (prdId === dependsOnPrdId) {
      return yield* Effect.fail(
        new ValidationError({
          reason: `A PRD cannot depend on itself: ${prdId}`,
        }),
      );
    }

    const prd = yield* findPrd(prdId);
    if (!prd) return yield* Effect.fail(new PrdNotFoundError({ id: prdId }));
    const dep = yield* findPrd(dependsOnPrdId);
    if (!dep) return yield* Effect.fail(new PrdNotFoundError({ id: dependsOnPrdId }));

    if (prd.projectId !== dep.projectId) {
      return yield* Effect.fail(
        new ValidationError({
          reason: `Cannot link PRDs from different projects: ${prdId} (project ${prd.projectId}) → ${dependsOnPrdId} (project ${dep.projectId})`,
        }),
      );
    }

    const existing = yield* findEdge(prdId, dependsOnPrdId);
    if (existing) return existing;

    const path = yield* findPath(dependsOnPrdId, prdId);
    if (path) {
      const cycle = [...path, dependsOnPrdId];
      return yield* Effect.fail(
        new ValidationError({
          reason: `Adding ${prdId} → ${dependsOnPrdId} would create cycle: ${cycle.join(" → ")}`,
        }),
      );
    }

    const rows = yield* dbQuery(() =>
      db.insert(prdDependsOn).values({ prdId, dependsOnPrdId }).returning(),
    );
    return rows[0]!;
  });

/**
 * Drop the dependency from `prdId` to `dependsOnPrdId`. No-op when the edge is
 * absent, so callers do not need to look it up beforehand.
 */
export const removeDependency = (prdId: string, dependsOnPrdId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    yield* dbQuery(() =>
      db
        .delete(prdDependsOn)
        .where(and(eq(prdDependsOn.prdId, prdId), eq(prdDependsOn.dependsOnPrdId, dependsOnPrdId))),
    );
    return undefined;
  });

/**
 * List the logical PRDs that `prdId` directly depends on (one hop forward in
 * the DAG).
 */
export const listDependencies = (prdId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const edges = yield* dbQuery(() =>
      db.query.prdDependsOn.findMany({
        where: { prdId },
        orderBy: { createdAt: "asc" },
      }),
    );
    const out: PrdRow[] = [];
    for (const e of edges) {
      const row = yield* dbQuery(() =>
        db.query.prds.findFirst({ where: { id: e.dependsOnPrdId } }),
      );
      if (row) out.push(row);
    }
    return out;
  });

/**
 * List the logical PRDs that directly depend on `prdId` (one hop backward,
 * i.e. "who depends on me"). Uses the `prd_depends_on_inverse_idx` index.
 */
export const listDependents = (prdId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const edges = yield* dbQuery(() =>
      db.query.prdDependsOn.findMany({
        where: { dependsOnPrdId: prdId },
        orderBy: { createdAt: "asc" },
      }),
    );
    const out: PrdRow[] = [];
    for (const e of edges) {
      const row = yield* dbQuery(() => db.query.prds.findFirst({ where: { id: e.prdId } }));
      if (row) out.push(row);
    }
    return out;
  });

/**
 * Build the full dependency graph for a project as `{ nodes, edges }`. `nodes`
 * is every logical PRD in the project; `edges` is every `(from, to)` pair that
 * has a `prd_depends_on` row. Suitable for textual graph rendering and for
 * web/JSON consumption.
 */
export const buildDependencyGraph = (projectId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const nodes = yield* dbQuery(() =>
      db.query.prds.findMany({
        where: { projectId },
        orderBy: { createdAt: "asc" },
      }),
    );
    const ids = new Set(nodes.map((n) => n.id));
    const allEdges = yield* dbQuery(() => db.query.prdDependsOn.findMany());
    const edges = allEdges
      .filter((e) => ids.has(e.prdId) && ids.has(e.dependsOnPrdId))
      .map((e) => ({ from: e.prdId, to: e.dependsOnPrdId }));
    return { nodes, edges };
  });

/** Re-export for external typing convenience. */
export type { PrdDependsOnRow };
