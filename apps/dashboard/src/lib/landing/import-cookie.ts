import { createHmac, timingSafeEqual } from "node:crypto";

export const LANDING_COOKIE_NAME = "kubri_landing_import";
export const LANDING_COOKIE_TTL_SEC = 30 * 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ImportBinding {
  importId: string;
  landingId: string;
}

let secretErrorLogged = false;

export function _resetSecretWarningForTests(): void {
  secretErrorLogged = false;
}

function secret(): string {
  const s = process.env["LANDING_COOKIE_SECRET"];
  if (!s || s.length < 32) throw new Error("LANDING_COOKIE_SECRET must be set (32+ chars)");
  return s;
}

function mac(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

/**
 * Cookie value binding one public import to the browser that started it:
 * `<importId>.<landingId>.<expSeconds>.<hmac>`. Public actions accept an
 * import id only from a valid cookie, never from the request body.
 */
export function signImportCookie(binding: ImportBinding, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + LANDING_COOKIE_TTL_SEC;
  const payload = `${binding.importId}.${binding.landingId}.${exp}`;
  return `${payload}.${mac(payload)}`;
}

export function verifyImportCookie(value: string | undefined, now = Date.now()): ImportBinding | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const [importId, landingId, expStr, sig] = parts as [string, string, string, string];
  if (!UUID_RE.test(importId) || !UUID_RE.test(landingId)) return null;
  const exp = Number(expStr);
  if (!Number.isInteger(exp) || exp * 1000 < now) return null;

  let expected: string;
  try {
    expected = mac(`${importId}.${landingId}.${expStr}`);
  } catch {
    if (!secretErrorLogged) {
      secretErrorLogged = true;
      console.error("[landing] LANDING_COOKIE_SECRET missing or too short");
    }
    return null;
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { importId, landingId };
}

export interface LandingCookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
}

export function landingCookieOptions(): LandingCookieOptions {
  return {
    httpOnly: true,
    secure: process.env["NODE_ENV"] === "production",
    sameSite: "lax" as const,
    path: "/candidati",
    maxAge: LANDING_COOKIE_TTL_SEC,
  };
}

function ipSalt(): string {
  const salt = process.env["LANDING_IP_SALT"] ?? "";
  if (process.env["NODE_ENV"] === "production") {
    if (salt.length < 16) throw new Error("LANDING_IP_SALT must be set (16+ chars)");
    return salt;
  }
  return salt || "dev-only-salt";
}

/** HMAC-SHA256 of the client IP, truncated: for rate-limit keys and audit, never the raw IP. */
export function hashIp(ip: string | null): string {
  return createHmac("sha256", ipSalt()).update(ip || "unknown").digest("hex").slice(0, 32);
}
