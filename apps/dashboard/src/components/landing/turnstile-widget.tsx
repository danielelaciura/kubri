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
 * and the server accepts the empty token outside production. `onError` fires
 * when the script cannot load or the widget fails (e.g. blocked by the network).
 */
export function TurnstileWidget({
  siteKey,
  locale,
  onToken,
  onError,
}: {
  siteKey: string;
  locale: string;
  onToken: (token: string) => void;
  onError?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Latest callback without re-rendering the widget when the parent re-renders.
  const cb = useRef(onToken);
  const errCb = useRef(onError);
  useEffect(() => {
    cb.current = onToken;
    errCb.current = onError;
  });
  const [scriptReady, setScriptReady] = useState(
    () => typeof window !== "undefined" && window.turnstile !== undefined,
  );

  useEffect(() => {
    if (!siteKey || !scriptReady || !ref.current || !window.turnstile) return;
    const id = window.turnstile.render(ref.current, {
      sitekey: siteKey,
      callback: (token) => cb.current(token),
      "expired-callback": () => cb.current(""),
      "error-callback": () => {
        cb.current("");
        errCb.current?.();
      },
      appearance: "interaction-only",
      language: locale,
    });
    return () => {
      if (id) window.turnstile?.remove(id);
    };
  }, [siteKey, scriptReady, locale]);

  if (!siteKey) return null;
  return (
    <>
      <Script
        {...scriptProps}
        onReady={() => setScriptReady(true)}
        onError={() => {
          cb.current("");
          errCb.current?.();
        }}
      />
      <div ref={ref} />
    </>
  );
}
