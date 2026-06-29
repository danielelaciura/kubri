"use client";
import { useEffect } from "react";
import { initAnalytics } from "@/lib/analytics";

/** Initializes Amplitude once on mount, client-side only. Renders nothing. */
export function Analytics() {
  useEffect(() => {
    initAnalytics();
  }, []);
  return null;
}
