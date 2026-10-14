"use client";

import {
  createContext,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const MIN_VISIBLE_MS = 400;

/** Registers one pending operation; returns the function that ends it. */
type BeginProgress = () => () => void;

const ProgressContext = createContext<BeginProgress | null>(null);

/**
 * Shows the top progress bar while `pending` is true. No-op outside
 * `<ProgressProvider>` (e.g. unauthenticated pages).
 */
export function usePendingProgress(pending: boolean) {
  const begin = useContext(ProgressContext);
  useEffect(() => {
    if (!pending || !begin) return;
    return begin();
  }, [pending, begin]);
}

/** `useTransition` whose pending state also drives the top progress bar. */
export function useProgressTransition() {
  const [isPending, startTransition] = useTransition();
  usePendingProgress(isPending);
  return [isPending, startTransition] as const;
}

/**
 * `useRouter` whose `push` runs inside a progress transition, so programmatic
 * navigations (filters, sorting, paging) show the top bar until the new page
 * has rendered.
 */
export function useProgressRouter() {
  const router = useRouter();
  const [, startTransition] = useProgressTransition();
  return useMemo<ReturnType<typeof useRouter>>(
    () => ({
      ...router,
      push: (...args) => startTransition(() => router.push(...args)),
    }),
    [router, startTransition],
  );
}

/**
 * Ends the anchor-click navigation token once the URL actually changes.
 * Isolated so `useSearchParams` only suspends this leaf, not the whole shell.
 */
function NavigationSettledListener({ onSettled }: { onSettled: () => void }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    const id = setTimeout(onSettled, 0);
    return () => clearTimeout(id);
  }, [pathname, searchParams, onSettled]);

  return null;
}

export function ProgressProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trickleRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);
  const activeCountRef = useRef(0);
  const endNavigationRef = useRef<(() => void) | null>(null);

  const clearTimers = () => {
    if (trickleRef.current) {
      clearInterval(trickleRef.current);
      trickleRef.current = null;
    }
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };

  const start = () => {
    clearTimers();
    startedAtRef.current = Date.now();
    setVisible(true);
    setProgress(12);
    trickleRef.current = setInterval(() => {
      setProgress((p) => (p < 90 ? p + (90 - p) * 0.08 : p));
    }, 200);
  };

  const finish = () => {
    if (trickleRef.current) {
      clearInterval(trickleRef.current);
      trickleRef.current = null;
    }
    setProgress(100);
    hideTimerRef.current = setTimeout(() => {
      setVisible(false);
      setProgress(0);
    }, 300);
  };

  const done = () => {
    const remaining = MIN_VISIBLE_MS - (Date.now() - startedAtRef.current);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    if (remaining > 0) {
      hideTimerRef.current = setTimeout(finish, remaining);
    } else {
      finish();
    }
  };

  // Ref-only body: stable identity so consumers' effects don't re-run.
  const begin = useCallback<BeginProgress>(() => {
    activeCountRef.current += 1;
    if (activeCountRef.current === 1) start();
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      activeCountRef.current -= 1;
      if (activeCountRef.current === 0) done();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onNavigationSettled = useCallback(() => {
    endNavigationRef.current?.();
    endNavigationRef.current = null;
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      try {
        const url = new URL(anchor.href, window.location.href);
        if (url.origin !== window.location.origin) return;
        if (
          url.pathname === window.location.pathname &&
          url.search === window.location.search
        ) {
          return;
        }
      } catch {
        return;
      }
      if (!endNavigationRef.current) endNavigationRef.current = begin();
    };

    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("click", onClick);
      clearTimers();
    };
  }, [begin]);

  return (
    <ProgressContext.Provider value={begin}>
      <div
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 z-[9999] h-1 w-full"
        style={{
          opacity: visible ? 1 : 0,
          transition: "opacity 300ms ease-out",
        }}
      >
        <div
          className="h-full w-full origin-left bg-primary"
          style={{
            transform: `scaleX(${progress / 100})`,
            transition: "transform 200ms ease-out",
            boxShadow:
              "0 0 10px var(--color-primary), 0 0 4px var(--color-primary)",
          }}
        />
      </div>
      <Suspense fallback={null}>
        <NavigationSettledListener onSettled={onNavigationSettled} />
      </Suspense>
      {children}
    </ProgressContext.Provider>
  );
}
