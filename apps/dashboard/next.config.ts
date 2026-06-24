import type { NextConfig } from "next";
import path from "path";

// Pin the root to the workspace root (one level up from apps/dashboard). In a
// multi-app workspace Next otherwise warns it inferred the root ambiguously;
// pinning it keeps build traces and module resolution deterministic.
const workspaceRoot = path.resolve(__dirname, "..", "..");

const nextConfig: NextConfig = {
  turbopack: {
    root: workspaceRoot,
  },
  outputFileTracingRoot: workspaceRoot,
};

export default nextConfig;
