import { describe, it, expect } from "vitest";
import { mapSupabaseError } from "@/lib/supabase/errors";
import { getDictionary, DEFAULT_LOCALE } from "@/lib/i18n";

const dict = getDictionary(DEFAULT_LOCALE);

describe("mapSupabaseError", () => {
  it("maps invalid_credentials to the dict message", () => {
    expect(mapSupabaseError({ code: "invalid_credentials" }, dict)).toBe(
      dict.authErrors.invalidCredentials,
    );
  });

  it("maps email_not_confirmed", () => {
    expect(mapSupabaseError({ code: "email_not_confirmed" }, dict)).toBe(
      dict.authErrors.emailNotConfirmed,
    );
  });

  it("maps over_email_send_rate_limit", () => {
    expect(mapSupabaseError({ code: "over_email_send_rate_limit" }, dict)).toBe(
      dict.authErrors.emailRateLimit,
    );
  });

  it("maps same_password", () => {
    expect(mapSupabaseError({ code: "same_password" }, dict)).toBe(
      dict.authErrors.samePassword,
    );
  });

  it("maps weak_password", () => {
    expect(mapSupabaseError({ code: "weak_password" }, dict)).toBe(
      dict.authErrors.weakPassword,
    );
  });

  it("falls back to generic message for unknown code", () => {
    expect(mapSupabaseError({ code: "some_unknown_code" }, dict)).toBe(
      dict.authErrors.generic,
    );
  });

  it("falls back to generic message for null", () => {
    expect(mapSupabaseError(null, dict)).toBe(dict.authErrors.generic);
  });

  it("accepts plain Error objects (no code) and returns generic", () => {
    expect(mapSupabaseError(new Error("boom"), dict)).toBe(
      dict.authErrors.generic,
    );
  });
});
