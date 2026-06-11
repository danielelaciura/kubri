import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/db";
import { DEFAULT_LOCALE, isLocale } from "./index";
import type { Locale } from "./types";

/**
 * Resolves the current user's UI locale from `User.language`.
 * Wrapped in React cache() so it runs at most once per request even when
 * called by the layout, the page and nested Server Components.
 * Falls back to DEFAULT_LOCALE when unauthenticated (login/error pages).
 */
export const getServerLocale = cache(async (): Promise<Locale> => {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();
    if (!authUser) return DEFAULT_LOCALE;

    const dbUser = await prisma.user.findUnique({
      where: { id: authUser.id },
      select: { language: true },
    });
    return isLocale(dbUser?.language) ? dbUser.language : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
});
