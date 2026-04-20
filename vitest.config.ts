import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    env: {
      NO_COLOR: "1",
    },
    testTimeout: 10000,
  },
});
