import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = url.searchParams.get("next") ?? "/auth/set-password";

  const supabase = await createSupabaseServerClient();

  // PKCE flow (invites sent from our app code via inviteUserByEmail)
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(
        new URL(
          `/login?error=${encodeURIComponent(error.code ?? "invalid_code")}`,
          request.url,
        ),
      );
    }
    return NextResponse.redirect(new URL(next, request.url));
  }

  // Token hash flow (invites/recovery/magic link sent from the Supabase
  // dashboard or from templates using {{ .TokenHash }} + type=invite|recovery|magiclink|email)
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    if (error) {
      return NextResponse.redirect(
        new URL(
          `/login?error=${encodeURIComponent(error.code ?? "invalid_token")}`,
          request.url,
        ),
      );
    }
    return NextResponse.redirect(new URL(next, request.url));
  }

  return NextResponse.redirect(
    new URL("/login?error=missing_code", request.url),
  );
}
