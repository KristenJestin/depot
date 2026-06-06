import path from "node:path";
import { describe, it } from "vite-plus/test";
import { e2eScenario } from "../runtime";

/**
 * PRD 0021 / T4 — `depot serve` + freeform docs drill-in surface.
 *
 * Spawns the CLI's HTTP server against an isolated SQLite DB and drives the
 * docs read endpoint through real `fetch` calls — the same harness used by
 * `prd-annexes-web.e2e.test.ts`.
 *
 * A. Seed a workspace + a freeform `doc_artifact` (relative `path`) via the
 *    CLI. GET `/api/projects/:id/docs` resolves and returns `absPath` =
 *    `<workspace root>/<relative path>` so the web "Open in editor" / "Copy
 *    path" actions have a concrete on-disk target. `defaultEditor` is null
 *    until configured; setting the `defaultEditor` project config surfaces it
 *    on the same response.
 */

type InitEnvelope = {
  project: { id: string };
  workspace: { id: string; path: string };
};

type DocsResponse = {
  artifacts: Array<{ id: string; kind: string; path: string; absPath: string | null }>;
  defaultEditor: string | null;
};

function pickHighPort(): number {
  return 49000 + Math.floor(Math.random() * 1000);
}

const REL_PATH = "src/frontend/i18n.md";

describe("e2e: freeform docs web surface (PRD 0021 / T4)", () => {
  it("A — GET /docs resolves absPath; defaultEditor config surfaces on the response", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("docs-freeform-a");
      const init = await ctx.agent.runJson<InitEnvelope>("depot --json init docs-freeform-a", {
        cwd: repo,
      });

      await ctx.agent.run(`depot doc touch ${REL_PATH} --kind freeform --title 'i18n notes'`, {
        cwd: repo,
      });
      ctx.expect.dbHas("doc_artifacts", { kind: "freeform", path: REL_PATH });

      const port = pickHighPort();
      const handle = ctx.agent.spawn(`depot serve --port ${port}`, { cwd: repo });
      await handle.waitForPort(port, 5000);

      try {
        const base = `http://127.0.0.1:${port}`;
        const projectId = init.project.id;
        const wsRoot = init.workspace.path;
        const expectedAbs = path.resolve(wsRoot, REL_PATH);

        const res = await fetch(`${base}/api/projects/${projectId}/docs`);
        if (res.status !== 200) {
          throw new Error(`GET /docs: expected 200, got ${res.status} — body: ${await res.text()}`);
        }
        const body = (await res.json()) as DocsResponse;

        const freeform = body.artifacts.find((a) => a.kind === "freeform");
        if (!freeform) {
          throw new Error(`expected a freeform artifact, got ${JSON.stringify(body.artifacts)}`);
        }
        if (freeform.path !== REL_PATH) {
          throw new Error(`expected relative path ${REL_PATH}, got ${freeform.path}`);
        }
        if (freeform.absPath !== expectedAbs) {
          throw new Error(
            `expected resolved absPath ${expectedAbs}, got ${JSON.stringify(freeform.absPath)}`,
          );
        }
        if (!path.isAbsolute(freeform.absPath)) {
          throw new Error(`expected absPath to be absolute, got ${freeform.absPath}`);
        }
        if (body.defaultEditor !== null) {
          throw new Error(`expected defaultEditor=null before config, got ${body.defaultEditor}`);
        }

        // Setting the project config surfaces it on the next read.
        const setRes = await ctx.agent.run(
          "depot project config set defaultEditor 'cursor://file/'",
          { cwd: repo },
        );
        ctx.expect.exitCode(setRes, 0);

        const res2 = await fetch(`${base}/api/projects/${projectId}/docs`);
        const body2 = (await res2.json()) as DocsResponse;
        if (body2.defaultEditor !== "cursor://file/") {
          throw new Error(
            `expected defaultEditor='cursor://file/' after config, got ${JSON.stringify(body2.defaultEditor)}`,
          );
        }
      } finally {
        handle.kill();
      }
    }, "docs-freeform-web A — freeform absPath + defaultEditor over HTTP");
  });
});
