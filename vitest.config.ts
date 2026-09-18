import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup/env.ts"],
    // Integration tests share one database; running files in parallel would
    // let one file's cleanup truncate another file's fixtures mid-run.
    fileParallelism: false,
    testTimeout: 20000,
  },
});
