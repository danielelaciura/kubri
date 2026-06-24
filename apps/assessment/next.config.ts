import type { NextConfig } from "next";
import path from "path";

// The workspace root (repo root, two levels up). Turbopack must use this as its
// root so it can resolve `next`, which pnpm installs in the workspace-root
// node_modules — outside this app's directory. Next still scopes the project to
// this app (apps/assessment); this only widens module resolution.
const workspaceRoot = path.resolve(__dirname, "../..");

const nextConfig: NextConfig = {
  // @kubri/contracts ships raw TS; Next must transpile it.
  transpilePackages: ["@kubri/contracts"],
  turbopack: {
    root: workspaceRoot,
  },
  outputFileTracingRoot: workspaceRoot,
};

export default nextConfig;
