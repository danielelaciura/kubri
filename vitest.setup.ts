import { config } from "dotenv";

// Load .env.local for tests that hit the real dev database (e.g. pool resolver,
// pool access helpers). vitest does not auto-load it.
config({ path: ".env.local" });

// Safety guard — see docs/superpowers/specs/2026-04-30-test-db-isolation.md.
// On 2026-04-30 a `pnpm test` run wiped real dev DB rows because vitest loaded
// `.env.local` (pointing at Supabase) and a DB-backed test ran `deleteMany({})`.
// Until PGLite isolation is in place, refuse to start the run if DATABASE_URL
// or DIRECT_URL point at a managed/remote host. Override with
// `ALLOW_REMOTE_TEST_DB=1` only if you know what you're doing.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const REMOTE_HOST_MARKERS = ["supabase.co", "supabase.com", "neon.tech", "pooler.supabase"];

function assertSafeDbUrl(name: string, raw: string | undefined): void {
  if (!raw) return;
  let host: string;
  try {
    host = new URL(raw).hostname;
  } catch {
    return;
  }
  const isLocal = LOCAL_HOSTS.has(host);
  const looksRemote = REMOTE_HOST_MARKERS.some((m) => host.includes(m)) || !isLocal;
  if (looksRemote && process.env.ALLOW_REMOTE_TEST_DB !== "1") {
    throw new Error(
      `[vitest guard] ${name} points to a remote host (${host}). ` +
        `Refusing to run tests against a non-local DB. ` +
        `See docs/superpowers/specs/2026-04-30-test-db-isolation.md. ` +
        `Set ALLOW_REMOTE_TEST_DB=1 to override (do NOT do this casually).`,
    );
  }
}

assertSafeDbUrl("DATABASE_URL", process.env.DATABASE_URL);
assertSafeDbUrl("DIRECT_URL", process.env.DIRECT_URL);
