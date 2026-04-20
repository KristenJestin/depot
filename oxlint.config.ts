import { defineConfig } from "oxlint";

export default defineConfig({
  plugins: ["typescript", "vitest"],
  env: {
    node: true,
  },
  rules: {
    // CLI tool — console.log is intentional in action handlers
    "no-console": "off",
  },
  ignorePatterns: ["dist/**"],
});
