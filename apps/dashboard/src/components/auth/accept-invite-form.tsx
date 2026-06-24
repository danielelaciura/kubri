"use client";

import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
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

  const code = searchParams.get("code");

  async function handleAccept() {
    if (!code) {
      setError(t.auth.inviteLinkInvalid);
      return;
    }

    setIsLoading(true);
    setError("");

    const supabase = createSupabaseBrowserClient();
    const { error: authError } = await supabase.auth.exchangeCodeForSession(code);

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
          disabled={isLoading || !code}
          className="w-full"
        >
          {isLoading ? t.auth.verifying : t.auth.acceptInvite}
        </Button>
      </CardContent>
    </Card>
  );
}
