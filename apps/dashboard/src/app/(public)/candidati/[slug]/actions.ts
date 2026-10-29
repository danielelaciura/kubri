"use server";

import { cookies, headers } from "next/headers";
// Don't re-export types from this "use server" file: import them from
// @/lib/landing/flow (Turbopack treats type re-exports as runtime exports).
import { getActiveLandingBySlug, type ActiveLanding } from "@/lib/landing/service";
import {
  confirmLandingImport,
  registerLandingUpload,
  requestLandingUpload,
  runLandingExtraction,
  type LandingResult,
  type RequestContext,
} from "@/lib/landing/flow";
import type { ContactPrefill } from "@/lib/landing/contact";
import {
  hashIp,
  LANDING_COOKIE_NAME,
  landingCookieOptions,
  signImportCookie,
  verifyImportCookie,
} from "@/lib/landing/import-cookie";

// Public endpoints: every argument is untrusted.

async function landingFor(slug: unknown): Promise<ActiveLanding | null> {
  return typeof slug === "string" ? getActiveLandingBySlug(slug) : null;
}

/** Null when the context cannot be built (hashIp throws without LANDING_IP_SALT in production). */
async function requestContext(): Promise<RequestContext | null> {
  // Vercel sets x-forwarded-for; the first hop is the client.
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  try {
    return { ip, ipHash: hashIp(ip) };
  } catch {
    console.error("[landing] request context unavailable");
    return null;
  }
}

async function boundImportId(landing: ActiveLanding): Promise<string | null> {
  const value = (await cookies()).get(LANDING_COOKIE_NAME)?.value;
  const binding = verifyImportCookie(value);
  return binding && binding.landingId === landing.id ? binding.importId : null;
}

export async function requestLandingUploadAction(
  slug: string,
  input: { fileName: string; fileSize: number; turnstileToken: string },
): Promise<LandingResult<{ storagePath: string; token: string }>> {
  const landing = await landingFor(slug);
  if (!landing) return { ok: false, error: "NOT_FOUND" };
  const ctx = await requestContext();
  if (!ctx) return { ok: false, error: "UNAVAILABLE" };
  const r = await requestLandingUpload(landing, input, ctx);
  if (!r.ok) return r;

  (await cookies()).set(
    LANDING_COOKIE_NAME,
    signImportCookie({ importId: r.data.importId, landingId: landing.id }),
    landingCookieOptions(),
  );
  return { ok: true, data: { storagePath: r.data.storagePath, token: r.data.token } };
}

export async function registerLandingUploadAction(
  slug: string,
  fileName: string,
): Promise<LandingResult<null>> {
  const landing = await landingFor(slug);
  if (!landing) return { ok: false, error: "NOT_FOUND" };
  const importId = await boundImportId(landing);
  if (!importId) return { ok: false, error: "SESSION_EXPIRED" };
  return registerLandingUpload(landing, importId, typeof fileName === "string" ? fileName : "");
}

export async function runLandingExtractionAction(slug: string): Promise<LandingResult<ContactPrefill>> {
  const landing = await landingFor(slug);
  if (!landing) return { ok: false, error: "NOT_FOUND" };
  const importId = await boundImportId(landing);
  if (!importId) return { ok: false, error: "SESSION_EXPIRED" };
  return runLandingExtraction(landing, importId);
}

export async function confirmLandingImportAction(
  slug: string,
  contact: unknown,
): Promise<LandingResult<null>> {
  const landing = await landingFor(slug);
  if (!landing) return { ok: false, error: "NOT_FOUND" };
  const importId = await boundImportId(landing);
  if (!importId) return { ok: false, error: "SESSION_EXPIRED" };
  const ctx = await requestContext();
  if (!ctx) return { ok: false, error: "UNAVAILABLE" };
  const r = await confirmLandingImport(landing, importId, contact, ctx);
  if (r.ok) (await cookies()).delete(LANDING_COOKIE_NAME);
  return r;
}
