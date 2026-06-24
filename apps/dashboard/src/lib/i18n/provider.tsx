"use client";

import { createContext, useContext } from "react";
import { getDictionary } from "./index";
import type { Dictionary, Locale } from "./types";

const I18nContext = createContext<Dictionary | null>(null);

export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  const dictionary = getDictionary(locale);
  return <I18nContext.Provider value={dictionary}>{children}</I18nContext.Provider>;
}

export function useT(): Dictionary {
  const dictionary = useContext(I18nContext);
  if (!dictionary) {
    throw new Error("useT must be used within <I18nProvider>");
  }
  return dictionary;
}
