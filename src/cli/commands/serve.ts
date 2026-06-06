import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { Schema } from "effect";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { command } from "#/cli/command";
import type { CommandOutput } from "#/cli/command";
import { defaultDepotDir } from "#/db/client";
import fs from "node:fs/promises";
import api from "#/web/api";

const YELLOW = "\u001b[33m";
const RESET = "\u001b[0m";

const DEFAULT_PORT = 4242;

/** Fixed portless route name so the server is always reachable at the same URL. */
const PORTLESS_NAME = "depot";
const PORTLESS_URL = `https://${PORTLESS_NAME}.localhost`;

const API_ONLY_BODY =
  "depot API-only mode.\n" +
  "The web UI bundle is not built. Available endpoints are under /api/.\n" +
  "Run 'vp build' to enable the web UI.\n";

function writeWarn(line: string): void {
  if (process.stderr.isTTY) {
    process.stderr.write(`${YELLOW}${line}${RESET}\n`);
  } else {
    process.stderr.write(`${line}\n`);
  }
}

function warnApiOnly(webBundlePath: string): void {
  writeWarn(
    `[depot serve] web bundle not found at ${webBundlePath}. ` +
      `Starting in API-only mode (REST endpoints available, static UI disabled). ` +
      `Run 'vp build' to build the web bundle.`,
  );
}

/**
 * Precedence for the listen port: an explicit `--port` flag wins, then the
 * `PORT` environment variable (so the server also works when launched through a
 * supervisor like `portless run` that injects `PORT`), then the default.
 */
export function resolvePort(explicit: number | undefined, env: string | undefined): number {
  if (explicit !== undefined) {
    return explicit;
  }
  if (env !== undefined) {
    const parsed = Number.parseInt(env, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_PORT;
}

type PortlessResult =
  | { status: "ok" }
  | { status: "missing" }
  | { status: "error"; detail: string };

/** Run a `portless` subcommand to completion, capturing failures instead of throwing. */
function runPortless(argv: string[]): Promise<PortlessResult> {
  return new Promise((resolveResult) => {
    const child = spawn("portless", argv, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        resolveResult({ status: "missing" });
      } else {
        resolveResult({ status: "error", detail: stderr.trim() || String(err) });
      }
    });
    child.once("close", (code) => {
      resolveResult(code === 0 ? { status: "ok" } : { status: "error", detail: stderr.trim() });
    });
  });
}

/** Register the static portless route and report the public URL (or why it failed). */
async function registerPortless(port: number, output: CommandOutput): Promise<void> {
  const result = await runPortless(["alias", PORTLESS_NAME, String(port), "--force"]);
  switch (result.status) {
    case "ok":
      output.print(`Depot also reachable at ${PORTLESS_URL}`);
      return;
    case "missing":
      writeWarn(
        `[depot serve] --portless: 'portless' was not found on PATH. ` +
          `Serving on http://localhost:${port} only. Install it with 'npm install -g portless'.`,
      );
      return;
    case "error":
      writeWarn(
        `[depot serve] --portless: could not register the route (portless alias)` +
          (result.detail ? `: ${result.detail}` : ".") +
          ` Is the proxy running? Start it with 'portless proxy start'.`,
      );
      return;
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
      description: `Port to listen on (defaults to $PORT or ${DEFAULT_PORT})`,
    },
    portless: {
      schema: Schema.Boolean,
      type: "boolean",
      default: false,
      description: `Expose the server via portless at ${PORTLESS_URL}`,
    },
  },
  run: async ({ args, output }) => {
    const port = resolvePort(args.port, process.env["PORT"]);

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

    const httpServer = serve({ fetch: server.fetch, port }, async () => {
      output.print(`Depot serving at http://localhost:${port}`);
      if (args.portless) {
        await registerPortless(port, output);
      }
      output.print("Press Ctrl+C to stop.");
    });

    process.on("SIGINT", () => {
      const shutdown = () => httpServer.close(() => process.exit(0));
      if (args.portless) {
        runPortless(["alias", "--remove", PORTLESS_NAME]).finally(shutdown);
      } else {
        shutdown();
      }
    });
  },
});
