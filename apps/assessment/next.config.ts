import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // @kubri/contracts ships raw TS; Next must transpile it.
  transpilePackages: ["@kubri/contracts"],
  // Scope file tracing to this app only. The dashboard currently lives at the
  // workspace root (incremental-monorepo layout), so if Next infers the root as
  // the workspace root it tries to pull the dashboard's root-level src/ (e.g.
  // its middleware.ts) into this build. Pinning the root here keeps the build
  // limited to the assessment app. Revisit after the Phase 2 consolidation moves
  // the dashboard into apps/dashboard (then the workspace root is clean).
  outputFileTracingRoot: path.resolve(__dirname),
};

export default nextConfig;
