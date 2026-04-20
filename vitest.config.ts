import { defineConfig, type Plugin } from "vitest/config";
import path from "path";
import fs from "fs";

// Vite cannot natively parse .md or .sql files as JS modules.
// This plugin transforms them into `export default "<content>"` at test time.
// At runtime (bun), `with { type: "text" }` import attributes handle loading.
function rawMdPlugin(): Plugin {
  return {
    name: "raw-text",
    transform(_code: string, id: string) {
      if (id.endsWith(".md") || id.endsWith(".sql")) {
        const content = fs.readFileSync(id, "utf-8");
        return { code: `export default ${JSON.stringify(content)};` };
      }
    },
  };
}

export default defineConfig({
  plugins: [rawMdPlugin()],
  resolve: {
    // Single alias: #/ → src/
    alias: {
      "#/": path.resolve(__dirname, "src") + "/",
    },
  },
  test: {
    globals: true,
    environment: "node",
    env: {
      NO_COLOR: "1",
    },
    testTimeout: 10000,
  },
});
