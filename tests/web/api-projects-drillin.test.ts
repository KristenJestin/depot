import { describe, it, expect, beforeAll, vi } from "vite-plus/test";
import { Layer, ManagedRuntime } from "effect";
import type { Database } from "#/db/client";
import { projects, projectDirectives, docProfiles } from "#/db/schema";
import { createTestDb } from "../helpers/db";

vi.mock("#/services/database", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#/services/database")>();
  return {
    ...actual,
    getDb: vi.fn<() => Promise<Database>>(),
    getRuntime: vi.fn<() => ManagedRuntime.ManagedRuntime<Db, never>>(),
  };
});

import { getDb, getRuntime, Db } from "#/services/database";
import app from "#/web/api";

const { db } = createTestDb();
const projectId = "proj-drill-1";
const otherProjectId = "proj-drill-2";

beforeAll(async () => {
  vi.mocked(getDb).mockResolvedValue(db);
  vi.mocked(getRuntime).mockReturnValue(ManagedRuntime.make(Layer.succeed(Db, db)));

  await db.insert(projects).values([
    { id: projectId, name: "Drill Project" },
    { id: otherProjectId, name: "Other Project" },
  ]);

  await db.insert(projectDirectives).values([
    {
      id: "dir-1",
      projectId,
      scope: "pre-review",
      category: "dev",
      title: "Format code",
      instruction: "bun run format --all",
      kind: "command",
      repoTarget: "api",
      blocking: true,
      position: 0,
      enabled: true,
      lastRunStatus: "fail",
      lastRunOutput: "STDOUT:\nboom\nSTDERR:\n",
    },
    {
      id: "dir-other",
      projectId: otherProjectId,
      scope: "always",
      category: "auditor",
      title: "Other directive",
      instruction: "noop",
      kind: "rule",
      repoTarget: "auto",
      blocking: false,
      position: 0,
      enabled: true,
    },
  ]);

  await db.insert(docProfiles).values([
    {
      id: "dp-1",
      projectId,
      name: "nyx-docs",
      targetRoot: "nyx-docs/src",
      targetPattern: "**/*.md",
      sources: JSON.stringify([{ name: "api", path: "./nyx-api" }]),
      language: "fr",
      style: "reference",
      audience: "developers",
      routingRules: JSON.stringify([
        { sourcePathGlob: "src/**/*.ts", targetDocPath: "api/index.md" },
      ]),
      topicsToCover: JSON.stringify(["auth", "payments"]),
      topicsToIgnore: JSON.stringify(["scratch"]),
      guardrails: JSON.stringify(["No secrets in docs"]),
      commitPolicy: "commit-with-message",
    },
  ]);
});

describe("web api — directive drill-in (PRD 0021 / T6)", () => {
  it("GET /api/projects/:id/directives/:directiveId returns the full row", async () => {
    const res = await app.request(`/api/projects/${projectId}/directives/dir-1`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { directive: Record<string, unknown> };
    expect(body.directive.id).toBe("dir-1");
    expect(body.directive.title).toBe("Format code");
    // The full instruction + last-run output the list view omits.
    expect(body.directive.instruction).toContain("bun run format --all");
    expect(body.directive.lastRunStatus).toBe("fail");
    expect(body.directive.lastRunOutput).toContain("boom");
    expect(body.directive.repoTarget).toBe("api");
    expect(body.directive.position).toBe(0);
  });

  it("404s for an unknown directive id", async () => {
    const res = await app.request(`/api/projects/${projectId}/directives/nope`);
    expect(res.status).toBe(404);
  });

  it("404s when the directive belongs to another project (no cross-project leak)", async () => {
    const res = await app.request(`/api/projects/${projectId}/directives/dir-other`);
    expect(res.status).toBe(404);
  });
});

describe("web api — doc-profile drill-in (PRD 0021 / T5)", () => {
  it("GET /api/projects/:id/doc-profiles/:name returns parsed metadata arrays", async () => {
    const res = await app.request(`/api/projects/${projectId}/doc-profiles/nyx-docs`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { profile: Record<string, unknown> };
    const p = body.profile;
    expect(p.name).toBe("nyx-docs");
    expect(p.targetRoot).toBe("nyx-docs/src");
    expect(p.targetPattern).toBe("**/*.md");
    expect(p.language).toBe("fr");
    expect(p.style).toBe("reference");
    expect(p.audience).toBe("developers");
    expect(p.commitPolicy).toBe("commit-with-message");
    // JSON columns parsed into structured arrays.
    expect(p.sources).toEqual([{ name: "api", path: "./nyx-api" }]);
    expect(p.routingRules).toEqual([
      { sourcePathGlob: "src/**/*.ts", targetDocPath: "api/index.md" },
    ]);
    expect(p.topicsToCover).toEqual(["auth", "payments"]);
    expect(p.topicsToIgnore).toEqual(["scratch"]);
    expect(p.guardrails).toEqual(["No secrets in docs"]);
  });

  it("404s for an unknown profile name", async () => {
    const res = await app.request(`/api/projects/${projectId}/doc-profiles/missing`);
    expect(res.status).toBe(404);
  });

  it("PATCH updates the profile and returns the parsed result", async () => {
    const res = await app.request(`/api/projects/${projectId}/doc-profiles/nyx-docs`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        language: "en",
        guardrails: ["No secrets", "Runnable code"],
        commitPolicy: "leave-in-working-tree",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { profile: Record<string, unknown> };
    expect(body.profile.language).toBe("en");
    expect(body.profile.commitPolicy).toBe("leave-in-working-tree");
    expect(body.profile.guardrails).toEqual(["No secrets", "Runnable code"]);

    // Persisted: a fresh GET reflects the edit.
    const after = await app.request(`/api/projects/${projectId}/doc-profiles/nyx-docs`);
    const afterBody = (await after.json()) as { profile: Record<string, unknown> };
    expect(afterBody.profile.language).toBe("en");
    expect(afterBody.profile.guardrails).toEqual(["No secrets", "Runnable code"]);
  });
});
