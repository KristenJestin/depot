import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { command } from "#/cli/command";
import { defaultDepotDir } from "#/db/client";
import fs from "node:fs/promises";
import api from "#/web/api";

const YELLOW = "\u001b[33m";
const RESET = "\u001b[0m";

const API_ONLY_BODY =
  "depot API-only mode.\n" +
  "The web UI bundle is not built. Available endpoints are under /api/.\n" +
  "Run 'vp build' to enable the web UI.\n";

function warnApiOnly(webBundlePath: string): void {
  const line =
    `[depot serve] web bundle not found at ${webBundlePath}. ` +
    `Starting in API-only mode (REST endpoints available, static UI disabled). ` +
    `Run 'vp build' to build the web bundle.`;
  if (process.stderr.isTTY) {
    process.stderr.write(`${YELLOW}${line}${RESET}\n`);
  } else {
    process.stderr.write(`${line}\n`);
  }
}

export const serveCommand = command({
  meta: { name: "serve", description: "Start the Depot web server" },
  args: {
    port: {
      schema: Schema.NumberFromString.pipe(
        Schema.filter((n) => Number.isInteger(n) && n > 0, {
          message: () => "--port must be a positive integer",
        }),
      ),
      default: "4242",
      description: "Port to listen on (default: 4242)",
    },
  },
  run: async ({ args, output }) => {
    const port = args.port;

    const depotDir = defaultDepotDir();
    await fs.mkdir(depotDir, { recursive: true });

    const server = new Hono();

    server.route("/", api);

    const distWebDir = fileURLToPath(new URL("web", import.meta.url));

    let hasWebBundle = true;
    try {
      await fs.access(distWebDir);
    } catch {
      hasWebBundle = false;
    }

    if (hasWebBundle) {
      server.use(
        "/*",
        serveStatic({
          root: distWebDir,
        }),
      );

      server.get("*", async (c) => {
        const html = await fs.readFile(resolve(distWebDir, "index.html"), "utf-8");
        return c.html(html);
      });
    } else {
      warnApiOnly(distWebDir);
      server.get("*", (c) => c.text(API_ONLY_BODY, 200));
    }

    const httpServer = serve({ fetch: server.fetch, port }, () => {
      output.print(`Depot serving at http://localhost:${port}`);
      output.print("Press Ctrl+C to stop.");
    });

    process.on("SIGINT", () => {
      httpServer.close(() => {
        process.exit(0);
      });
    });
  },
});
