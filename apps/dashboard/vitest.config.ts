import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // DB-backed tests in src/lib/pools/__tests__ share the dev database;
    // disable cross-file parallelism so they don't trample each other.
    fileParallelism: false,
    exclude: [
      "**/node_modules/**",
      "**/.worktrees/**",
      "**/.claude/worktrees/**",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
