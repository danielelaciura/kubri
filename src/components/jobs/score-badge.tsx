import { cn } from "@/lib/utils";

interface ScoreBadgeProps {
  value: number;
  /** Total number of segments in the gauge. Defaults to 10. */
  segments?: number;
  /** Optional size override. `sm` for inline use in tables, `lg` for detail headers. */
  size?: "sm" | "lg";
  className?: string;
}

/**
 * Segmented bar gauge. Renders `segments` vertical bars; the leftmost ones are
 * filled (emerald) in proportion to `value` (0-100), the rest stay muted.
 *
 * An sr-only span exposes the numeric percentage for accessibility.
 */
export function ScoreBadge({
  value,
  segments = 10,
  size = "sm",
  className,
}: ScoreBadgeProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const filled = Math.round((clamped / 100) * segments);

  const barClass =
    size === "lg" ? "h-7 w-2.5 rounded-[2px]" : "h-5 w-1.5 rounded-[2px]";

  return (
    <span
      role="img"
      aria-label={`Score ${clamped}%`}
      className={cn("inline-flex items-center gap-[3px]", className)}
    >
      {Array.from({ length: segments }, (_, i) => (
        <span
          key={i}
          className={cn(
            barClass,
            i < filled ? "bg-emerald-500" : "bg-muted",
          )}
        />
      ))}
      <span className="sr-only">{clamped}%</span>
    </span>
  );
}
