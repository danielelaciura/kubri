import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const PREFIX = "sha256=";

/** The header Meta sends: "sha256=" and the hex HMAC-SHA256 of the raw body. */
export function signBody(appSecret: string, rawBody: Buffer): string {
  return `${PREFIX}${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
}

/**
 * Spec §16.3: checked on the raw bytes, before any parsing, in constant time. A header that
 * is missing, has another prefix or is not hex of the right length is simply not valid.
 */
export function verifySignature(
  appSecret: string,
  rawBody: Buffer,
  header: string | undefined,
): boolean {
  if (!header?.startsWith(PREFIX)) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const given = Buffer.from(header.slice(PREFIX.length), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Constant time whatever the lengths: both sides are hashed to the same size first (C8). */
function sameSecret(given: string, expected: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

/** The GET Meta sends once when the webhook is set up: echo `hub.challenge` if the token matches. */
export function verifyChallenge(query: URLSearchParams, verifyToken: string): string | null {
  const challenge = query.get("hub.challenge");
  const token = query.get("hub.verify_token");
  if (query.get("hub.mode") !== "subscribe" || token === null) return null;
  if (!sameSecret(token, verifyToken)) return null;
  return challenge === null || challenge === "" ? null : challenge;
}
