import type { SendOutcome } from "../channel";

type Failure = Extract<SendOutcome, { ok: false }>;

// Meta's Graph API error codes. Documented ones only; anything else follows the HTTP status.
const PERMANENT: Readonly<Record<number, string>> = {
  131047: "outside_window", // re-engagement: the 24 hour window is closed
  131026: "not_reachable", // undeliverable
  131030: "not_allowed", // recipient not in the allowed list (test numbers)
  131021: "to_self",
  131051: "unsupported_type",
  100: "invalid_request",
  190: "auth_failed", // token expired or invalid: an operator must act
  10: "permission",
  200: "permission",
};

const TRANSIENT: Readonly<Record<number, string>> = {
  130429: "rate_limited",
  131056: "rate_limited",
  80007: "rate_limited",
  4: "rate_limited",
  17: "rate_limited",
  32: "rate_limited",
  613: "rate_limited",
  131000: "meta_unavailable",
  131016: "meta_unavailable",
  1: "meta_unavailable",
  2: "meta_unavailable",
};

const known = (table: Readonly<Record<number, string>>, code: number): string | undefined =>
  Object.hasOwn(table, code) ? table[code] : undefined;

/**
 * The name a Meta error code is recorded with (`Message.errorCode`): the same for a failure
 * at send time and one reported later as a delivery status (C3).
 */
export function errorName(code: number): string {
  return known(TRANSIENT, code) ?? known(PERMANENT, code) ?? `meta_${code}`;
}

function errorCode(body: unknown): number | undefined {
  if (typeof body !== "object" || body === null || !("error" in body)) return undefined;
  const error = body.error;
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "number" ? error.code : undefined;
}

/** D119: temporary (try again, then give up) or permanent (stop the turn's other messages). */
export function classifyError(httpStatus: number, body: unknown): Failure {
  const code = errorCode(body);
  if (code !== undefined) {
    const transient = known(TRANSIENT, code);
    if (transient) return { ok: false, kind: "transient", code: transient };
    const permanent = known(PERMANENT, code);
    if (permanent) return { ok: false, kind: "permanent", code: permanent };
  }
  if (httpStatus === 429) return { ok: false, kind: "transient", code: "rate_limited" };
  if (httpStatus >= 500 || httpStatus === 408) {
    return { ok: false, kind: "transient", code: `http_${httpStatus}` };
  }
  return {
    ok: false,
    kind: "permanent",
    code: code === undefined ? `http_${httpStatus}` : errorName(code),
  };
}
