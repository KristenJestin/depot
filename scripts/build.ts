import { cpSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const start = performance.now();

rmSync(resolve("dist"), { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  target: "bun",
  sourcemap: "none",
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

// Prepend shebang so the output is directly executable via `#!/usr/bin/env bun`
const outFile = resolve("dist/index.js");
await Bun.write(outFile, `#!/usr/bin/env bun\n${await Bun.file(outFile).text()}`);

// Copy migration SQL files alongside the bundle (resolved via import.meta.dir at runtime)
cpSync(resolve("src/db/migrations"), resolve("dist/migrations"), { recursive: true });

console.log(`build complete in ${(performance.now() - start).toFixed(0)}ms`);
