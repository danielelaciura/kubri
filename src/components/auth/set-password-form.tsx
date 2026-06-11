"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { mapSupabaseError } from "@/lib/supabase/errors";
import { getDictionary, DEFAULT_LOCALE } from "@/lib/i18n";

// Auth pages render pre-login and have no user locale — use the default locale.
const authDictionary = getDictionary(DEFAULT_LOCALE);
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const PW_RE = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;

export function SetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!PW_RE.test(password)) {
      setError("Minimo 8 caratteri, almeno una lettera e un numero");
      return;
    }
    if (password !== confirm) {
      setError("Le password non coincidono");
      return;
    }

    setIsLoading(true);
    const supabase = createSupabaseBrowserClient();
    const { error: authError } = await supabase.auth.updateUser({ password });

    if (authError) {
      setError(mapSupabaseError(authError, authDictionary));
      setIsLoading(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Imposta la tua password</CardTitle>
        <CardDescription>Scegli una password per accedere a Kubri.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            type="password"
            placeholder="Password (min. 8, lettere e numeri)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isLoading}
            autoComplete="new-password"
            required
            minLength={8}
          />
          <Input
            type="password"
            placeholder="Conferma password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={isLoading}
            autoComplete="new-password"
            required
            minLength={8}
          />
          {error && <p className="text-sm text-destructive text-center">{error}</p>}
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? "Salvataggio..." : "Imposta password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
