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
 * Pick the bar color based on the score band.
 * Bands: <50 grey, <60 red, <70 orange, <80 yellow, <90 light green, ≥90 green.
 */
function fillColorClass(value: number): string {
  if (value < 50) return "bg-gray-400";
  if (value < 60) return "bg-red-500";
  if (value < 70) return "bg-orange-500";
  if (value < 80) return "bg-yellow-400";
  if (value < 90) return "bg-emerald-400";
  return "bg-emerald-600";
}

/**
 * Segmented bar gauge. Renders `segments` vertical bars; the leftmost ones
 * are filled in proportion to `value` (0-100), the rest stay muted. The fill
 * color reflects the score band (grey → red → orange → yellow → light green →
 * green).
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
  const fillClass = fillColorClass(clamped);

  const barClass =
    size === "lg" ? "h-6 w-2 rounded-[2px]" : "h-4 w-[5px] rounded-[1.5px]";

  return (
    <span
      role="img"
      aria-label={`Score ${clamped}%`}
      className={cn("inline-flex items-center gap-[2px]", className)}
    >
      {Array.from({ length: segments }, (_, i) => (
        <span
          key={i}
          className={cn(barClass, i < filled ? fillClass : "bg-muted")}
        />
      ))}
      <span className="sr-only">{clamped}%</span>
    </span>
  );
}
