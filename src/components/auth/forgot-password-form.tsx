"use client";

import { useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);

    const supabase = createSupabaseBrowserClient();
    // Note: we deliberately ignore the error — feedback is always generic to avoid user enumeration.
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/auth/reset-password`,
    });

    setSubmitted(true);
    setIsLoading(false);
  }

  if (submitted) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Controlla la tua email</CardTitle>
          <CardDescription>
            Se un account esiste per {email}, riceverai un link per reimpostare la password.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <Link href="/login" className="text-sm underline">
            Torna al login
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Password dimenticata</CardTitle>
        <CardDescription>
          Ti invieremo un link per reimpostare la password.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            type="email"
            placeholder="nome@esempio.it"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isLoading}
            autoComplete="email"
            required
          />
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? "Invio in corso..." : "Invia link"}
          </Button>
          <p className="text-center text-sm">
            <Link href="/login" className="text-muted-foreground underline">
              Torna al login
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
