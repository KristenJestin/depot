import { describe, it } from "vite-plus/test";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { e2eScenario } from "../runtime";
import { getRepoRoot } from "../runtime";

/**
 * PRD 0016 / T2 — `depot serve` + HTTP probes.
 *
 * Spawn `depot serve --port <port>` in the background via the runtime's new
 * `agent.spawn` helper, wait for the TCP port, then exercise two endpoints
 * through real `fetch` calls: `GET /api/projects` (must list the project we
 * just created) and `POST /api/projects/:id/directives` (must accept a
 * valid payload and persist it). The child is auto-killed by the scenario's
 * cleanup hook on body exit, success or throw.
 *
 * `depot serve` aborts at startup if `dist/web/` is missing (it expects the
 * web UI bundle alongside the CLI binary). The repo's build pipeline only
 * produces `dist/web/` when `vp build` runs, which the E2E pipeline does
 * not invoke. We therefore materialize a minimal placeholder
 * `dist/web/index.html` once per process if absent — enough to satisfy the
 * `fs.access` probe, without affecting the API surface we test.
 */

type CreatedProject = { id: string; name: string };
type ListProjects = { items: ReadonlyArray<CreatedProject> };
type CreatedDirective = { item: { id: string } };

async function ensureDistWebStub(): Promise<void> {
  const distWebDir = path.join(getRepoRoot(), "dist", "web");
  if (existsSync(path.join(distWebDir, "index.html"))) {
    return;
  }
  await mkdir(distWebDir, { recursive: true });
  await writeFile(
    path.join(distWebDir, "index.html"),
    "<!doctype html><title>depot e2e stub</title>",
    "utf-8",
  );
}

function pickHighPort(): number {
  // 47000–47999 is a deliberately high range used by no IANA service. Tests
  // run with `singleThread: true` in the e2e config, so collisions across
  // scenarios are not a concern; the random offset only guards against a
  // back-to-back re-run hitting a still-TIME_WAIT socket.
  return 47000 + Math.floor(Math.random() * 1000);
}

describe("e2e: depot serve + HTTP probes (PRD 0016 / T2)", () => {
  it("spawns serve, probes /api/projects + POST /directives, then kills the child", async () => {
    await ensureDistWebStub();
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("serve-app");
      await ctx.agent.run("depot init serve-app", { cwd: repo });

      // Add a PRD so /api/projects sees a non-trivial project (prdCount > 0).
      await ctx.agent.runJson("depot --json prd create --title 'Serve PRD'", { cwd: repo });

      const port = pickHighPort();
      const handle = ctx.agent.spawn(`depot serve --port ${port}`, { cwd: repo });

      await handle.waitForPort(port, 5000);

      const projectsRes = await fetch(`http://127.0.0.1:${port}/api/projects`);
      if (projectsRes.status !== 200) {
        throw new Error(
          `GET /api/projects: expected status 200, got ${projectsRes.status} — body: ${await projectsRes.text()}`,
        );
      }
      const projects = (await projectsRes.json()) as ListProjects;
      if (!Array.isArray(projects.items) || projects.items.length === 0) {
        throw new Error(
          `GET /api/projects: expected items[] to contain at least one project, got ${JSON.stringify(projects)}`,
        );
      }
      const project = projects.items.find((p) => p.name === "serve-app");
      if (!project) {
        throw new Error(
          `GET /api/projects: expected to find a 'serve-app' project, got ${JSON.stringify(projects.items)}`,
        );
      }

      const directivePayload = {
        category: "dev",
        scope: "always",
        kind: "rule",
        title: "Serve probe rule",
        instruction: "Document that the serve probe wrote this rule.",
      };
      const directiveRes = await fetch(
        `http://127.0.0.1:${port}/api/projects/${project.id}/directives`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(directivePayload),
        },
      );
      if (directiveRes.status !== 201) {
        throw new Error(
          `POST /directives: expected status 201, got ${directiveRes.status} — body: ${await directiveRes.text()}`,
        );
      }
      const created = (await directiveRes.json()) as CreatedDirective;
      if (!created.item?.id) {
        throw new Error(
          `POST /directives: expected payload to contain item.id, got ${JSON.stringify(created)}`,
        );
      }

      ctx.expect.dbHas("project_directives", {
        id: created.item.id,
        project_id: project.id,
        title: "Serve probe rule",
      });

      handle.kill();
    }, "serve http probes");
  });
});
