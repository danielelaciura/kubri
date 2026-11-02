"use client";

import { useT } from "@/lib/i18n/provider";

const STEPS = ["upload", "check", "send"] as const;
const TOTAL = STEPS.length;

/**
 * Minimal progress for the CV path: one line of text ("Passo 1 di 3 · Carica
 * il CV", plus what is happening right now) over a thin bar that fills a third
 * per step. `current` 0–2 is the active step; `TOTAL` means the application was
 * sent (bar full).
 */
export function LandingSteps({ current, status }: { current: 0 | 1 | 2 | typeof TOTAL; status?: string }) {
  const t = useT().landing;
  const complete = current === TOTAL;
  const position = complete ? TOTAL : current + 1;
  const label = complete
    ? t.stepsComplete
    : `${t.stepOf.replace("{n}", String(position)).replace("{total}", String(TOTAL))} · ${t.steps[STEPS[current]]}`;

  return (
    <div className="space-y-2">
      <p className="text-sm">
        <span className="font-medium">{label}</span>
        {status && <span className="text-muted-foreground"> · {status}</span>}
      </p>
      <div
        role="progressbar" aria-label={t.stepsLabel} aria-valuemin={0} aria-valuemax={TOTAL}
        aria-valuenow={position} aria-valuetext={label}
        className="h-1 overflow-hidden rounded-full bg-border"
      >
        <div
          className="h-full origin-left rounded-full bg-primary transition-transform duration-200 ease-out motion-reduce:transition-none"
          style={{ transform: `scaleX(${position / TOTAL})` }}
        />
      </div>
    </div>
  );
}
