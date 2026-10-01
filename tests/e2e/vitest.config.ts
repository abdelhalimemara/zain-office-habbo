import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

/** Run with `npm run test:e2e`. Kept out of `npm test` by the *.e2e.ts suffix. */
export default defineConfig({
  root: fileURLToPath(new URL("../..", import.meta.url)),
  test: {
    include: ["tests/e2e/**/*.e2e.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 180_000,
    teardownTimeout: 30_000,
  },
});
