import { cn } from "@/lib/utils";

interface ScoreBadgeProps {
  value: number;
  className?: string;
}

export function ScoreBadge({ value, className }: ScoreBadgeProps) {
  const color =
    value >= 70
      ? "bg-emerald-600 text-white"
      : value >= 40
        ? "bg-amber-500 text-white"
        : "bg-gray-400 text-white";
  return (
    <span
      className={cn(
        "inline-flex min-w-[3rem] items-center justify-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
        color,
        className,
      )}
    >
      {value}%
    </span>
  );
}
