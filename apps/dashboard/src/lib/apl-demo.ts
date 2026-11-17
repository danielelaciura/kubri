// The Kubri x APL sales demo (apps/apl-demo) is a separate Vercel project that
// the dashboard proxies under a secret path of its own domain. The secret path
// is the demo's only access control and this repo is public, so both values
// live only in the environment. Either one unset = no proxy, no public prefix.

/** "/demo-apl-xyz" from "demo-apl-xyz", "/demo-apl-xyz/" etc.; null when unset or blank. */
export function aplDemoPath(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.APL_DEMO_PATH?.trim().replace(/^\/+|\/+$/g, "");
  return raw ? `/${raw}` : null;
}

/** Origin of the demo's Vercel deployment, without trailing slash; null when unset. */
export function aplDemoOrigin(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.APL_DEMO_ORIGIN?.trim().replace(/\/+$/, "");
  return raw || null;
}

/** True when `pathname` is the demo path or below it (not a look-alike prefix). */
export function isAplDemoPath(pathname: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const base = aplDemoPath(env);
  if (!base || !aplDemoOrigin(env)) return false;
  return pathname === base || pathname.startsWith(base + "/");
}

/** Rewrites that proxy the demo path to the demo deployment (empty when not configured). */
export function aplDemoRewrites(env: NodeJS.ProcessEnv = process.env) {
  const base = aplDemoPath(env);
  const origin = aplDemoOrigin(env);
  if (!base || !origin) return [];
  return [
    { source: base, destination: `${origin}${base}` },
    { source: `${base}/:path*`, destination: `${origin}${base}/:path*` },
  ];
}
