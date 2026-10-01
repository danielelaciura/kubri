import { Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface MatchesLoadingProps {
  title: string;
  hint: string;
}

/**
 * Loading state for the candidate matching (embedding rank + LLM rerank,
 * which can take several seconds). Hook-free so it works both as a Suspense
 * fallback in the Server Component and inside the client refresh wrapper.
 */
export function MatchesLoading({ title, hint }: MatchesLoadingProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-lg border border-border/60 bg-card p-6 shadow-sm"
    >
      <div className="flex items-center gap-3">
        <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" />
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="text-sm text-muted-foreground">{hint}</p>
        </div>
      </div>
      <div className="mt-6 space-y-3" aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="h-8 w-8 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-3 w-2/3" />
            </div>
            <Skeleton className="h-6 w-12" />
          </div>
        ))}
      </div>
    </div>
  );
}
