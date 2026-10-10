"use client";

import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getDictionary, DEFAULT_LOCALE } from "@/lib/i18n";

// AcceptInviteForm is rendered on the unauthenticated /auth/accept-invite route,
// outside <DashboardShell> and therefore outside <I18nProvider>. The invitee
// has no stored locale yet, so we use the default locale dictionary directly.
const t = getDictionary(DEFAULT_LOCALE);

export function AcceptInviteForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  // token_hash: invite email template → /auth/callback → here (current flow).
  // code: legacy PKCE redirect from inviteUserByEmail's redirectTo.
  const tokenHash = searchParams.get("token_hash");
  const type = (searchParams.get("type") ?? "invite") as EmailOtpType;
  const code = searchParams.get("code");
  const hasToken = Boolean(tokenHash || code);

  async function handleAccept() {
    if (!hasToken) {
      setError(t.auth.inviteLinkInvalid);
      return;
    }

    setIsLoading(true);
    setError("");

    const supabase = createSupabaseBrowserClient();
    const { error: authError } = tokenHash
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      : await supabase.auth.exchangeCodeForSession(code!);

    if (authError) {
      setError(t.auth.inviteLinkExpired);
      setIsLoading(false);
      return;
    }

    router.push("/auth/set-password");
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">{t.auth.welcomeTitle}</CardTitle>
        <CardDescription>
          {t.auth.inviteDescription}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-destructive text-center">{error}</p>}
        <Button
          onClick={handleAccept}
          disabled={isLoading || !hasToken}
          className="w-full"
        >
          {isLoading ? t.auth.verifying : t.auth.acceptInvite}
        </Button>
      </CardContent>
    </Card>
  );
}
