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
  searchLandingPlaces,
  type LandingResult,
  type RequestContext,
} from "@/lib/landing/flow";
import type { LandingPrefill } from "@/lib/landing/contact";
import type { PlaceSuggestion } from "@/lib/geo/place-types";
import {
  cookieSecretReady,
  hashIp,
  LANDING_COOKIE_NAME,
  landingCookieOptions,
  signImportCookie,
  verifyImportCookie,
} from "@/lib/landing/import-cookie";

// Public endpoints: every argument is untrusted.

type Fail = { ok: false; error: "NOT_FOUND" | "UNAVAILABLE" };

/** The landing, or the failure result to return as-is. */
async function landingFor(slug: unknown): Promise<ActiveLanding | Fail> {
  if (typeof slug !== "string") return { ok: false, error: "NOT_FOUND" };
  try {
    return (await getActiveLandingBySlug(slug)) ?? { ok: false, error: "NOT_FOUND" };
  } catch {
    console.error("[landing] landing lookup failed");
    return { ok: false, error: "UNAVAILABLE" };
  }
}

function isFail(x: ActiveLanding | Fail): x is Fail {
  return "ok" in x;
}

let secretLogged = false;

/** Null when the context cannot be built (hashIp throws without LANDING_IP_SALT in production). */
async function requestContext(): Promise<RequestContext | null> {
  // Prefer the headers the platform sets itself. The first x-forwarded-for hop
  // is only trustworthy behind Vercel (elsewhere the client can spoof it).
  const h = await headers();
  const ip =
    h.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip")?.trim() ||
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    null;
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
  if (isFail(landing)) return landing;
  if (!cookieSecretReady()) {
    if (!secretLogged) {
      secretLogged = true;
      console.error("[landing] LANDING_COOKIE_SECRET missing or too short");
    }
    return { ok: false, error: "UNAVAILABLE" };
  }
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
  if (isFail(landing)) return landing;
  const importId = await boundImportId(landing);
  if (!importId) return { ok: false, error: "SESSION_EXPIRED" };
  return registerLandingUpload(landing, importId, typeof fileName === "string" ? fileName : "");
}

export async function runLandingExtractionAction(slug: string): Promise<LandingResult<LandingPrefill>> {
  const landing = await landingFor(slug);
  if (isFail(landing)) return landing;
  const importId = await boundImportId(landing);
  if (!importId) return { ok: false, error: "SESSION_EXPIRED" };
  return runLandingExtraction(landing, importId);
}

export async function searchLandingPlacesAction(
  slug: string,
  input: unknown,
): Promise<LandingResult<PlaceSuggestion[]>> {
  const landing = await landingFor(slug);
  if (isFail(landing)) return landing;
  const importId = await boundImportId(landing);
  if (!importId) return { ok: false, error: "SESSION_EXPIRED" };
  const ctx = await requestContext();
  if (!ctx) return { ok: false, error: "UNAVAILABLE" };
  return searchLandingPlaces(landing, importId, input, ctx);
}

export async function confirmLandingImportAction(
  slug: string,
  contact: unknown,
): Promise<LandingResult<null>> {
  const landing = await landingFor(slug);
  if (isFail(landing)) return landing;
  const importId = await boundImportId(landing);
  if (!importId) return { ok: false, error: "SESSION_EXPIRED" };
  const ctx = await requestContext();
  if (!ctx) return { ok: false, error: "UNAVAILABLE" };
  const r = await confirmLandingImport(landing, importId, contact, ctx);
  if (r.ok) (await cookies()).delete({ name: LANDING_COOKIE_NAME, path: landingCookieOptions().path });
  return r;
}
