"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/provider";

const STEPS = ["upload", "check", "send"] as const;

/**
 * Where the candidate is in the CV path: upload → check details → send.
 * `current` is the index of the active step; earlier steps show as done.
 */
export function LandingSteps({ current }: { current: 0 | 1 | 2 }) {
  const t = useT().landing;
  return (
    <ol aria-label={t.stepsLabel} className="flex items-start gap-2">
      {STEPS.map((key, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li
            key={key} aria-current={active ? "step" : undefined}
            className="flex min-w-0 flex-1 flex-col gap-1.5"
          >
            <span
              aria-hidden="true"
              className={cn(
                "h-1 rounded-full transition-colors duration-200 motion-reduce:transition-none",
                done || active ? "bg-primary" : "bg-border",
              )}
            />
            <span
              className={cn(
                "flex items-center gap-1 text-xs leading-tight",
                active ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {done && <Check className="size-3.5 shrink-0 text-primary" aria-hidden="true" />}
              {t.steps[key]}
              {done && <span className="sr-only"> ({t.stepDone})</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
