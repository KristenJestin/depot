import { Hono } from "hono";
import path from "node:path";
import { existsSync } from "node:fs";
import * as DomainProjectConfig from "#/modules/projects/config";
import * as DomainDirectives from "#/modules/projects/directives";
import * as DomainRepos from "#/modules/projects/repos";
import { getRuntime } from "#/services/database";
import { logActivity } from "#/modules/activity/domain";
import { KNOWN_PROJECT_CONFIG_KEYS, isKnownProjectConfigKey } from "#/shared/project-config-keys";
import {
  VALID_DIRECTIVE_CATEGORIES,
  VALID_DIRECTIVE_KINDS,
  VALID_DIRECTIVE_SCOPES,
  isValidCategoryScope,
  validScopesForCategory,
  type DirectiveCategory,
  type DirectiveKind,
  type DirectiveScope,
} from "#/shared/validator";
import type { Variables } from "./types";

export const projectsRoutes = new Hono<{ Variables: Variables }>()
  .get("/projects", async (c) => {
    const db = c.var.db;
    const projects = await db.query.projects.findMany({ orderBy: { name: "asc" } });
    // Pre-compute the workspace count + PRD count per project so the
    // /projects index card has a glanceable summary without round-trips.
    const ids = projects.map((p) => p.id);
    let workspaceCounts: Record<string, number> = {};
    let prdCounts: Record<string, number> = {};
    let docCounts: Record<string, number> = {};
    let directiveCounts: Record<string, number> = {};
    if (ids.length > 0) {
      const ws = await db.query.workspaces.findMany({ columns: { projectId: true } });
      for (const w of ws) workspaceCounts[w.projectId] = (workspaceCounts[w.projectId] ?? 0) + 1;
      const prds = await db.query.prds.findMany({ columns: { projectId: true } });
      for (const p of prds) prdCounts[p.projectId] = (prdCounts[p.projectId] ?? 0) + 1;
      const docs = await db.query.docArtifacts.findMany({ columns: { projectId: true } });
      for (const d of docs) docCounts[d.projectId] = (docCounts[d.projectId] ?? 0) + 1;
      const dirs = await db.query.projectDirectives.findMany({
        columns: { projectId: true },
      });
      for (const d of dirs) directiveCounts[d.projectId] = (directiveCounts[d.projectId] ?? 0) + 1;
    }
    const items = projects.map((p) => ({
      ...p,
      workspaceCount: workspaceCounts[p.id] ?? 0,
      prdCount: prdCounts[p.id] ?? 0,
      docCount: docCounts[p.id] ?? 0,
      directiveCount: directiveCounts[p.id] ?? 0,
    }));
    return c.json({ items }, 200);
  })
  .get("/projects/:id/config", async (c) => {
    const { id } = c.req.param();
    const existing = await getRuntime().runPromise(DomainProjectConfig.listConfig(id));
    const byKey = new Map(existing.map((row) => [row.key, row]));
    const items = Object.entries(KNOWN_PROJECT_CONFIG_KEYS).map(([key, descriptor]) => {
      const row = byKey.get(key);
      return {
        key,
        label: descriptor.label,
        description: descriptor.description,
        defaultValue: descriptor.default,
        currentValue: row?.value ?? null,
        source: row?.updatedBySource ?? null,
        updatedAt: row?.updatedAt ?? null,
      };
    });
    return c.json({ items, knownKeys: Object.keys(KNOWN_PROJECT_CONFIG_KEYS) }, 200);
  })
  .patch("/projects/:id/config", async (c) => {
    const { id } = c.req.param();
    type Body = { key?: string; value?: string | null };
    const body = (await c.req.json()) as Body;
    if (!body.key) return c.json({ error: "Missing key" }, 422);
    if (!isKnownProjectConfigKey(body.key)) {
      return c.json(
        { error: `Unknown key: ${body.key}`, knownKeys: Object.keys(KNOWN_PROJECT_CONFIG_KEYS) },
        400,
      );
    }
    const descriptor = KNOWN_PROJECT_CONFIG_KEYS[body.key]!;
    const previous = await getRuntime().runPromise(DomainProjectConfig.getConfig(id, body.key));
    if (body.value === null || body.value === undefined) {
      await getRuntime().runPromise(DomainProjectConfig.unsetConfig(id, body.key));
      await getRuntime().runPromise(
        logActivity({
          projectId: id,
          eventType: "project_config_changed",
          payload: {
            key: body.key,
            previousValue: previous?.value ?? null,
            newValue: null,
          },
          source: "human",
        }),
      );
      return c.json({ key: body.key, value: null }, 200);
    }
    const validation = descriptor.validate(body.value);
    if (!validation.ok) {
      return c.json({ error: validation.reason }, 422);
    }
    const item = await getRuntime().runPromise(
      DomainProjectConfig.setConfig(id, body.key, body.value, "human"),
    );
    await getRuntime().runPromise(
      logActivity({
        projectId: id,
        eventType: "project_config_changed",
        payload: {
          key: body.key,
          previousValue: previous?.value ?? null,
          newValue: body.value,
        },
        source: "human",
      }),
    );
    return c.json({ item }, 200);
  })
  .get("/projects/:id/repos", async (c) => {
    const { id } = c.req.param();
    const db = c.var.db;
    const repos = await getRuntime().runPromise(DomainRepos.listRepos(id));
    if (repos.length > 0) {
      return c.json({ items: repos, implicit: false }, 200);
    }
    const workspace = await db.query.workspaces.findFirst({ where: { projectId: id } });
    const resolved = await getRuntime().runPromise(
      DomainRepos.resolveProjectRepos(id, workspace?.path ?? process.cwd()),
    );
    return c.json({ items: resolved, implicit: true }, 200);
  })
  .post("/projects/:id/repos", async (c) => {
    const { id } = c.req.param();
    const db = c.var.db;
    type Body = {
      name?: string;
      path?: string;
      isPrimary?: boolean;
      baseBranch?: string;
    };
    const body = (await c.req.json()) as Body;
    if (!body.name || !body.path) {
      return c.json({ error: "name and path are required" }, 422);
    }
    const workspace = await db.query.workspaces.findFirst({ where: { projectId: id } });
    const resolvedPath = path.isAbsolute(body.path)
      ? body.path
      : path.resolve(workspace?.path ?? process.cwd(), body.path);
    if (!existsSync(resolvedPath)) {
      return c.json({ error: `Path does not exist: ${resolvedPath}` }, 422);
    }
    if (!existsSync(path.join(resolvedPath, ".git"))) {
      return c.json({ error: `Path is not a git repo (no .git): ${resolvedPath}` }, 422);
    }
    try {
      const item = await getRuntime().runPromise(
        DomainRepos.addRepo({
          projectId: id,
          name: body.name,
          path: resolvedPath,
          isPrimary: body.isPrimary,
          baseBranch: body.baseBranch,
        }),
      );
      return c.json({ item }, 201);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 422);
    }
  })
  .patch("/projects/:id/repos/:repoId", async (c) => {
    const { repoId } = c.req.param();
    type Body = { baseBranch?: string; isPrimary?: boolean };
    const body = (await c.req.json()) as Body;
    try {
      const item = await getRuntime().runPromise(DomainRepos.updateRepo(repoId, body));
      return c.json({ item }, 200);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 422);
    }
  })
  .delete("/projects/:id/repos/:repoId", async (c) => {
    const { repoId } = c.req.param();
    await getRuntime().runPromise(DomainRepos.removeRepo(repoId));
    return c.json({ id: repoId }, 200);
  })
  .get("/projects/:id/directives", async (c) => {
    const { id } = c.req.param();
    const scopeQuery = c.req.query("scope") as DirectiveScope | undefined;
    const items = await getRuntime().runPromise(
      DomainDirectives.listDirectives(id, { scope: scopeQuery }),
    );
    return c.json({ items }, 200);
  })
  .post("/projects/:id/directives", async (c) => {
    const { id } = c.req.param();
    type Body = {
      category?: string;
      scope?: string;
      kind?: string;
      title?: string;
      instruction?: string;
      blocking?: boolean;
      position?: number;
      repoTarget?: string;
    };
    const body = (await c.req.json()) as Body;
    if (!body.category || !body.scope || !body.kind || !body.title || !body.instruction) {
      return c.json({ error: "category, scope, kind, title, instruction are required" }, 422);
    }
    if (!VALID_DIRECTIVE_CATEGORIES.includes(body.category as DirectiveCategory)) {
      return c.json(
        {
          error: `Unknown category: ${body.category}. Allowed: ${VALID_DIRECTIVE_CATEGORIES.join(", ")}`,
        },
        422,
      );
    }
    if (!VALID_DIRECTIVE_SCOPES.includes(body.scope as DirectiveScope)) {
      return c.json({ error: `Unknown scope: ${body.scope}` }, 422);
    }
    if (!VALID_DIRECTIVE_KINDS.includes(body.kind as DirectiveKind)) {
      return c.json({ error: `Unknown kind: ${body.kind}` }, 422);
    }
    if (!isValidCategoryScope(body.category as DirectiveCategory, body.scope as DirectiveScope)) {
      const valid = validScopesForCategory(body.category as DirectiveCategory);
      return c.json(
        {
          error: `Scope '${body.scope}' is not valid for category '${body.category}'. Valid scopes: ${valid.join(", ")}`,
        },
        422,
      );
    }
    try {
      const item = await getRuntime().runPromise(
        DomainDirectives.createDirective({
          projectId: id,
          category: body.category as DirectiveCategory,
          scope: body.scope as DirectiveScope,
          kind: body.kind as DirectiveKind,
          title: body.title,
          instruction: body.instruction,
          blocking: body.blocking,
          position: body.position,
          repoTarget: body.repoTarget,
        }),
      );
      await getRuntime().runPromise(
        logActivity({
          projectId: id,
          eventType: "directive_added",
          payload: { directiveId: item.id, title: item.title },
          source: "human",
        }),
      );
      return c.json({ item }, 201);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 422);
    }
  })
  .patch("/projects/:id/directives/:directiveId", async (c) => {
    const { id, directiveId } = c.req.param();
    type Body = {
      title?: string;
      instruction?: string;
      kind?: DirectiveKind;
      blocking?: boolean;
      position?: number;
      enabled?: boolean;
      repoTarget?: string;
    };
    const body = (await c.req.json()) as Body;
    try {
      const item = await getRuntime().runPromise(
        DomainDirectives.updateDirective(directiveId, body),
      );
      const fields = Object.keys(body);
      await getRuntime().runPromise(
        logActivity({
          projectId: id,
          eventType: "directive_updated",
          payload: { directiveId: item.id, fields },
          source: "human",
        }),
      );
      return c.json({ item }, 200);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 422);
    }
  })
  .delete("/projects/:id/directives/:directiveId", async (c) => {
    const { id, directiveId } = c.req.param();
    await getRuntime().runPromise(DomainDirectives.removeDirective(directiveId));
    await getRuntime().runPromise(
      logActivity({
        projectId: id,
        eventType: "directive_removed",
        payload: { directiveId },
        source: "human",
      }),
    );
    return c.json({ id: directiveId }, 200);
  })
  .post("/projects/:id/directives/:directiveId/run", async (c) => {
    const { id, directiveId } = c.req.param();
    const db = c.var.db;
    const project = await db.query.projects.findFirst({ where: { id } });
    if (!project) return c.json({ error: "Project not found" }, 404);
    const workspace = await db.query.workspaces.findFirst({ where: { projectId: id } });
    const wsPath = workspace?.path ?? process.cwd();
    try {
      // `runDirective` emits the `directive_run` activity log entry itself
      // (with full repo selection traceability — PRD 0007 T1), so the web
      // wrapper just forwards `source: "human"` and returns the result.
      const result = await getRuntime().runPromise(
        DomainDirectives.runDirective(directiveId, { wsPath, source: "human" }),
      );
      return c.json(result, 200);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 422);
    }
  });
