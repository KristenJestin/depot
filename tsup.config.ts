import { defineConfig } from "tsup";
import fs from "fs";
import path from "path";

// esbuild does not support `with { type: "text" }` import attributes.
// This plugin strips them from TypeScript source files before esbuild processes them.
// The `.md` and `.sql` loaders below ensure the files are still inlined as text strings.
const stripTextWithPlugin = {
  name: "strip-text-with",
  setup(build: any) {
    build.onLoad({ filter: /\.ts$/ }, (args: any) => {
      const contents = fs.readFileSync(args.path, "utf-8");
      const patched = contents.replace(/\s+with\s*\{[^}]*\}/g, "");
      return { contents: patched, loader: "ts" };
    });
  },
};

const copyMigrationsPlugin = {
  name: "copy-migrations",
  setup(build: any) {
    build.onEnd(() => {
      const distDir = path.resolve("dist");
      const sourceDir = path.resolve("src/db/migrations");
      const targetDir = path.resolve(distDir, "migrations");
      fs.rmSync(targetDir, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(targetDir), { recursive: true });
      fs.cpSync(sourceDir, targetDir, { recursive: true });

      for (const entry of fs.readdirSync(distDir, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name !== "migrations") {
          fs.rmSync(path.join(distDir, entry.name), { recursive: true, force: true });
        }
      }
    });
  },
};

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["cjs"],
    outDir: "dist",
    splitting: false,
    sourcemap: false,
    clean: true,
    banner: {
      js: "#!/usr/bin/env bun",
    },
    platform: "node",
    target: "node18",
    noExternal: ["citty", "drizzle-orm", "chalk", "ulid"],
    external: ["bun:sqlite"],
    minify: false,
    esbuildPlugins: [stripTextWithPlugin, copyMigrationsPlugin],
    esbuildOptions(options) {
      options.loader = { ...options.loader, ".md": "text", ".sql": "text" };
    },
  },
]);
