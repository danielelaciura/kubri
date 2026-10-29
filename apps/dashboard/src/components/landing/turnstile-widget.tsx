"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";

interface TurnstileApi {
  render(
    el: HTMLElement,
    opts: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
      appearance: "interaction-only";
      language: string;
    },
  ): string;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

// Spread so the `src` attribute type-checks even where next's own React types
// resolve loosely (pnpm hoisting); behaviour is identical to inline props.
const scriptProps = {
  src: "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
  strategy: "afterInteractive" as const,
};

/**
 * Invisible-unless-needed Cloudflare Turnstile. Reports a fresh token (or ""
 * when it expires / errors). Tokens are single-use: remount it (change `key`)
 * after each upload attempt. Without a site key (local dev) it renders nothing
 * and the server accepts the empty token outside production.
 */
export function TurnstileWidget({
  siteKey,
  locale,
  onToken,
}: {
  siteKey: string;
  locale: string;
  onToken: (token: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scriptReady, setScriptReady] = useState(
    () => typeof window !== "undefined" && window.turnstile !== undefined,
  );

  useEffect(() => {
    if (!siteKey || !scriptReady || !ref.current || !window.turnstile) return;
    const id = window.turnstile.render(ref.current, {
      sitekey: siteKey,
      callback: onToken,
      "expired-callback": () => onToken(""),
      "error-callback": () => onToken(""),
      appearance: "interaction-only",
      language: locale,
    });
    return () => window.turnstile?.remove(id);
  }, [siteKey, scriptReady, locale, onToken]);

  if (!siteKey) return null;
  return (
    <>
      <Script {...scriptProps} onReady={() => setScriptReady(true)} />
      <div ref={ref} />
    </>
  );
}
