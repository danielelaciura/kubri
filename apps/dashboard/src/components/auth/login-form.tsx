"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { mapSupabaseError } from "@/lib/supabase/errors";
import { getDictionary, DEFAULT_LOCALE } from "@/lib/i18n";

// Auth pages render pre-login and have no user locale — use the default locale.
const authDictionary = getDictionary(DEFAULT_LOCALE);
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Image from "next/image";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!email || !password) {
      setError("Inserisci email e password");
      return;
    }

    setIsLoading(true);

    const supabase = createSupabaseBrowserClient();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError(mapSupabaseError(authError, authDictionary));
      setIsLoading(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  const imageStyle = {
    margin: "10px auto"
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <Image
              src="/kubri-logo.png"
              alt="Kubri"
              width={42}
              height={42}
              style={imageStyle}
        />
        <CardTitle className="text-2xl font-bold">Kubri</CardTitle>
        <CardDescription>Accedi al tuo account</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium leading-none">
              Email
            </label>
            <Input
              id="email"
              type="email"
              placeholder="nome@esempio.it"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isLoading}
              autoComplete="email"
              required
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium leading-none">
              Password
            </label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading}
              autoComplete="current-password"
              required
            />
          </div>
          {error && <p className="text-sm text-destructive text-center">{error}</p>}
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? "Accesso in corso..." : "Accedi"}
          </Button>
          <p className="text-center text-sm">
            <Link href="/login/forgot" className="text-muted-foreground underline">
              Password dimenticata?
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
