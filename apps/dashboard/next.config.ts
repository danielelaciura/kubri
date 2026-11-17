import type { NextConfig } from "next";
import path from "path";
import { aplDemoRewrites } from "./src/lib/apl-demo";

// Pin the root to the workspace root (one level up from apps/dashboard). In a
// multi-app workspace Next otherwise warns it inferred the root ambiguously;
// pinning it keeps build traces and module resolution deterministic.
const workspaceRoot = path.resolve(__dirname, "..", "..");

const nextConfig: NextConfig = {
  turbopack: {
    root: workspaceRoot,
  },
  outputFileTracingRoot: workspaceRoot,
  outputFileTracingIncludes: {
    "/api/assessment/report": ["./src/components/report/fonts/**"],
  },
  // Kubri x APL sales demo, proxied under a secret path (see src/lib/apl-demo.ts).
  async rewrites() {
    return aplDemoRewrites();
  },
};

export default nextConfig;
