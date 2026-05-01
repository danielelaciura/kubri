import { config } from "dotenv";

// Load .env.local for tests that hit the real dev database (e.g. pool resolver,
// pool access helpers). vitest does not auto-load it.
config({ path: ".env.local" });
