import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["tests/setup-env.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // RLS suite talks to the live Supabase project — run serially.
    pool: "forks",
    fileParallelism: false,
    maxWorkers: 1,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
