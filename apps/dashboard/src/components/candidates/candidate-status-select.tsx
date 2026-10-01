"use client";

import { useState, useTransition } from "react";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  CANDIDATE_STATUSES,
  type CandidateStatusValue,
} from "@/lib/candidates/status";
import { setCandidateStatus } from "@/app/(dashboard)/dashboard/candidates/[id]/actions";

const STATUS_STYLES: Record<CandidateStatusValue, string> = {
  NEW: "border-border bg-muted text-foreground",
  CONTACTED: "border-sky-200 bg-sky-50 text-sky-700",
  SCREENING: "border-sky-200 bg-sky-50 text-sky-700",
  INTERVIEW: "border-blue-200 bg-blue-50 text-blue-700",
  OFFER: "border-indigo-200 bg-indigo-50 text-indigo-700",
  HIRED: "border-emerald-200 bg-emerald-50 text-emerald-700",
  NOT_SELECTED: "border-red-200 bg-red-50 text-red-700",
};

interface CandidateStatusSelectProps {
  candidateId: string;
  status: CandidateStatusValue;
}

export function CandidateStatusSelect({
  candidateId,
  status,
}: CandidateStatusSelectProps) {
  const t = useT();
  const [current, setCurrent] = useState<CandidateStatusValue>(status);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const select = (next: CandidateStatusValue) => {
    setOpen(false);
    if (next === current) return;
    const previous = current;
    setCurrent(next);
    setError(null);
    startTransition(async () => {
      try {
        await setCandidateStatus(candidateId, next);
      } catch {
        // Rollback optimistic update on error
        setCurrent(previous);
        setError(t.candidateStatus.updateError);
      }
    });
  };

  return (
    // Stop clicks (including from the portalled popup) reaching the table row.
    <div
      className="inline-flex flex-col items-start"
      onClick={(e) => e.stopPropagation()}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              aria-label={t.candidateStatus.label}
              disabled={isPending}
              className={cn(
                "inline-flex h-6 items-center gap-1 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap transition-opacity hover:opacity-80 disabled:opacity-60",
                STATUS_STYLES[current],
              )}
            >
              {t.candidateStatus.values[current]}
              {isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
            </button>
          }
        />
        <PopoverContent align="start" className="w-48 p-1">
          {CANDIDATE_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => select(s)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
            >
              <span
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full border",
                  STATUS_STYLES[s],
                )}
              />
              <span className="flex-1 text-left">
                {t.candidateStatus.values[s]}
              </span>
              {s === current && (
                <Check className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
          ))}
        </PopoverContent>
      </Popover>
      {error && <p className="pt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
