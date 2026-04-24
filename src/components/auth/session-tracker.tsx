"use client";

import { useEffect, useRef } from "react";
import { trackLoginAction } from "@/lib/auth-actions";

export function SessionTracker() {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    void trackLoginAction();
  }, []);

  return null;
}
