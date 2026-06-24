import { defineConfig } from "vitest/config";

// Root-level config for the non-dashboard workspace tests (the dashboard owns
// its own vitest.config.ts under apps/dashboard). Covers packages/* and the
// assessment app.
export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: ["packages/**/*.test.ts", "apps/assessment/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/.next/**", "apps/dashboard/**"],
  },
});
