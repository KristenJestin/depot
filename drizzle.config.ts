import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  // Standard Drizzle migration output. Runtime migrations read from here in dev
  // and from the copied folder in `dist/` after build.
  out: "./src/db/migrations",
  casing: "snake_case",
});
