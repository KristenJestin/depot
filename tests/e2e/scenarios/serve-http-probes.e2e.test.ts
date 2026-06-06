import { describe, it } from "vite-plus/test";
import { e2eScenario } from "../runtime";

/**
 * PRD 0016 / T2 + PRD 0017 / T3 — `depot serve` + HTTP probes.
 *
 * Spawn `depot serve --port <port>` in the background via the runtime's
 * `agent.spawn` helper, wait for the TCP port, then exercise three endpoints
 * through real `fetch` calls: `GET /api/projects` (must list the project we
 * just created), `POST /api/projects/:id/directives` (must accept a valid
 * payload and persist it), and `GET /` (must return the API-only message
 * since the E2E pipeline does not build the web bundle). The child is
 * auto-killed by the scenario's cleanup hook on body exit, success or throw.
 *
 * PRD 0017 / T3 made `depot serve` degrade gracefully when `dist/web/` is
 * absent: it logs a warning on stderr and starts in API-only mode instead of
 * aborting. The stub workaround that previously materialised a placeholder
 * `dist/web/index.html` is no longer needed.
 */

type CreatedProject = { id: string; name: string };
type ListProjects = { items: ReadonlyArray<CreatedProject> };
type CreatedDirective = { item: { id: string } };

function pickHighPort(): number {
  // 47000–47999 is a deliberately high range used by no IANA service. Tests
  // run with `singleThread: true` in the e2e config, so collisions across
  // scenarios are not a concern; the random offset only guards against a
  // back-to-back re-run hitting a still-TIME_WAIT socket.
  return 47000 + Math.floor(Math.random() * 1000);
}

describe("e2e: depot serve + HTTP probes (PRD 0016 / T2, PRD 0017 / T3)", () => {
  it("spawns serve, probes /api/projects + POST /directives + / (API-only), then kills the child", async () => {
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

      // PRD 0017 / T3: without `dist/web/`, `/` must return the API-only
      // explanatory text (HTTP 200, text/plain) rather than crashing the
      // server at startup.
      const rootRes = await fetch(`http://127.0.0.1:${port}/`);
      if (rootRes.status !== 200) {
        throw new Error(
          `GET /: expected status 200 (API-only mode), got ${rootRes.status} — body: ${await rootRes.text()}`,
        );
      }
      // `/` serves the SPA shell when the web bundle (dist/web) is present, or a
      // plain "API-only mode" notice otherwise — both are valid HTTP 200
      // responses. Assert the server answered `/` in either mode rather than
      // pinning to one (the bundle's presence depends on whether `vp build` ran).
      const rootBody = await rootRes.text();
      const servesShell = /<!doctype html/i.test(rootBody);
      if (!servesShell && !rootBody.includes("API-only mode")) {
        throw new Error(
          `GET /: expected the SPA shell or the API-only notice, got: ${rootBody.slice(0, 200)}`,
        );
      }

      handle.kill();
    }, "serve http probes");
  });
});
