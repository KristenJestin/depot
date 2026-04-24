import { defineConfig } from "vite-plus";
import path from "node:path";
import { cpSync } from "node:fs";
import devServer from "@hono/vite-dev-server";
import nodeAdapter from "@hono/vite-dev-server/node";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

function rawMdPlugin() {
  return {
    name: "raw-text",
    transform(_code: string, id: string) {
      if (id.endsWith(".md") || id.endsWith(".sql")) {
        const { readFileSync } = require("node:fs");
        const content = readFileSync(id, "utf-8");
        return { code: `export default ${JSON.stringify(content)};` };
      }
    },
  };
}

export default defineConfig({
  root: path.resolve(import.meta.dirname, "src/web"),

  plugins: [
    tailwindcss(),
    react(),
    devServer({ entry: "api.ts", adapter: nodeAdapter }),
    rawMdPlugin(),
  ],

  build: {
    outDir: path.resolve(import.meta.dirname, "dist/web"),
    emptyOutDir: true,
  },

  resolve: {
    alias: {
      "#/": path.resolve(import.meta.dirname, "src") + "/",
    },
  },

  test: {
    globals: true,
    environment: "node",
    env: { NO_COLOR: "1" },
    testTimeout: 10000,
    root: path.resolve(import.meta.dirname),
    include: ["tests/**/*.test.ts"],
  },

  lint: {
    plugins: ["typescript", "vitest"],
    env: { node: true },
    rules: {
      // CLI tool — console.log is intentional in action handlers
      "no-console": "off",
    },
    ignorePatterns: ["dist/**"],
  },

  fmt: {
    printWidth: 100,
    singleQuote: false,
    semi: true,
    tabWidth: 2,
    trailingComma: "all",
    ignorePatterns: ["dist/**", "node_modules/**"],
  },

  pack: {
    entry: ["src/index.ts"],
    outDir: "dist",
    platform: "node",
    format: "esm",
    banner: { js: "#!/usr/bin/env node" },
    plugins: [rawMdPlugin()],
    onSuccess() {
      cpSync(
        path.resolve(import.meta.dirname, "src/db/migrations"),
        path.resolve(import.meta.dirname, "dist/migrations"),
        { recursive: true },
      );
    },
  },
});
