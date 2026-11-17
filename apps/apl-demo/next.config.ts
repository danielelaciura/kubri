import type { NextConfig } from "next";
import path from "path";

// Workspace root (two levels up): pnpm installs `next` there, outside this app.
const workspaceRoot = path.resolve(__dirname, "..", "..");

// The demo is published under a secret path of app.kubri.it (the dashboard
// proxies `${APL_DEMO_PATH}/*` to this app's Vercel deployment). The path is the
// only thing keeping the demo private and this repo is public, so it comes from
// the environment and must never be written in code. Unset = served at "/".
const rawPath = process.env.APL_DEMO_PATH?.trim().replace(/^\/+|\/+$/g, "") ?? "";
const basePath = rawPath ? `/${rawPath}` : "";

// `STATIC_EXPORT=1 pnpm build` produces a plain static site in `out/` (the zip
// that runs offline on another PC). The Vercel build is a normal Next build.
const staticExport = process.env.STATIC_EXPORT === "1";

const nextConfig: NextConfig = {
  ...(basePath ? { basePath } : {}),
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  images: { unoptimized: true },
  // Static export needs folder/index.html URLs; behind the dashboard proxy we
  // match the dashboard's no-trailing-slash URLs to avoid a redirect ping-pong.
  trailingSlash: staticExport,
  turbopack: { root: workspaceRoot },
  outputFileTracingRoot: workspaceRoot,
  ...(staticExport
    ? { output: "export" as const }
    : {
        async headers() {
          return [{ source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] }];
        },
      }),
};

export default nextConfig;
