import { init, track } from "@amplitude/analytics-browser";

// NEXT_PUBLIC_ so it's available client-side. When unset, analytics is a no-op
// (so local/dev without a key just works).
const API_KEY = process.env.NEXT_PUBLIC_AMPLITUDE_API_KEY;

let initialized = false;

/**
 * Initialize Amplitude once, client-side only. Anonymous by design: we never
 * call setUserId and never send personal data. `autocapture` is OFF so no
 * clicks/inputs/form data (which could contain PII) are captured automatically
 * — only the explicit funnel events sent via trackEvent are recorded.
 */
export function initAnalytics(): void {
  if (initialized || typeof window === "undefined" || !API_KEY) return;
  initialized = true;
  init(API_KEY, {
    serverZone: "EU",
    autocapture: false,
  });
}

/**
 * Track an explicit funnel event. No-op without an API key.
 * NEVER pass personal data in `props` — keep properties anonymous (section
 * index, CTA type, etc.).
 */
export function trackEvent(name: string, props?: Record<string, unknown>): void {
  if (!API_KEY) return;
  track(name, props);
}
