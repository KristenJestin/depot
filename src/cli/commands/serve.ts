import { resolve } from "node:path";
import { Schema } from "effect";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { command } from "#/cli/command";
import { openDatabase, defaultDepotDir, defaultDbPath } from "#/db/client";
import { normalizeWorkspacePath } from "#/shared/utils";
import fs from "node:fs/promises";
import api, { type Variables } from "#/web/api";

async function resolveCurrentWorkspaceId(
  db: ReturnType<typeof openDatabase>["db"],
): Promise<string | null> {
  try {
    const cwd = normalizeWorkspacePath(process.cwd());
    const rows = await db.query.workspaces.findMany();
    let bestMatch: (typeof rows)[number] | null = null;
    let bestLen = 0;
    for (const ws of rows) {
      const wsPath = normalizeWorkspacePath(ws.path);
      if (cwd === wsPath || cwd.startsWith(wsPath + "/")) {
        if (wsPath.length > bestLen) {
          bestLen = wsPath.length;
          bestMatch = ws;
        }
      }
    }
    return bestMatch?.id ?? null;
  } catch {
    return null;
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

    const { db } = openDatabase(defaultDbPath());
    const currentWorkspaceId = await resolveCurrentWorkspaceId(db);

    const server = new Hono<{ Variables: Variables }>();

    server.use("*", async (c, next) => {
      c.set("db", db);
      c.set("currentWorkspaceId", currentWorkspaceId);
      await next();
    });

    server.route("/", api);

    const distWebDir = resolve(import.meta.dirname, "web");

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
