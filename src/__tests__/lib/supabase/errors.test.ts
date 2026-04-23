import { describe, it, expect } from "vitest";
import { mapSupabaseError } from "@/lib/supabase/errors";

describe("mapSupabaseError", () => {
  it("maps invalid_credentials to Italian message", () => {
    expect(mapSupabaseError({ code: "invalid_credentials" })).toBe(
      "Email o password non validi",
    );
  });

  it("maps email_not_confirmed", () => {
    expect(mapSupabaseError({ code: "email_not_confirmed" })).toBe(
      "Devi completare l'invito via email prima di accedere",
    );
  });

  it("maps over_email_send_rate_limit", () => {
    expect(mapSupabaseError({ code: "over_email_send_rate_limit" })).toBe(
      "Troppi tentativi, riprova tra qualche minuto",
    );
  });

  it("maps same_password", () => {
    expect(mapSupabaseError({ code: "same_password" })).toBe(
      "La nuova password deve essere diversa dalla precedente",
    );
  });

  it("maps weak_password", () => {
    expect(mapSupabaseError({ code: "weak_password" })).toBe(
      "La password non rispetta i requisiti minimi (8 caratteri, lettere e numeri)",
    );
  });

  it("falls back to generic message for unknown code", () => {
    expect(mapSupabaseError({ code: "some_unknown_code" })).toBe(
      "Si è verificato un errore, riprova",
    );
  });

  it("falls back to generic message for null", () => {
    expect(mapSupabaseError(null)).toBe("Si è verificato un errore, riprova");
  });

  it("accepts plain Error objects (no code) and returns generic", () => {
    expect(mapSupabaseError(new Error("boom"))).toBe(
      "Si è verificato un errore, riprova",
    );
  });
});
