import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["cjs"],
    outDir: "dist",
    splitting: false,
    sourcemap: false,
    clean: true,
    banner: {
      js: "#!/usr/bin/env node",
    },
    platform: "node",
    target: "node18",
    noExternal: ["commander", "@commander-js/extra-typings", "drizzle-orm", "chalk"],
    external: ["@libsql/client"],
    minify: false,
  },^
]);
