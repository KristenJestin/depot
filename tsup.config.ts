import { defineConfig } from "tsup";
import fs from "fs";

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
    esbuildPlugins: [stripTextWithPlugin],
    esbuildOptions(options) {
      options.loader = { ...options.loader, ".md": "text", ".sql": "text" };
    },
  },
]);
