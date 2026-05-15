import { cn } from "@/lib/utils";

interface ScoreBadgeProps {
  value: number;
  size?: "sm" | "lg";
  className?: string;
}

export function ScoreBadge({ value, size = "sm", className }: ScoreBadgeProps) {
  const color =
    value >= 70
      ? "bg-emerald-600 text-white"
      : value >= 40
        ? "bg-amber-500 text-white"
        : "bg-gray-400 text-white";

  const sizing =
    size === "lg"
      ? "min-w-[3.5rem] h-[3.5rem] text-xl font-bold rounded-lg"
      : "min-w-[3rem] px-2.5 py-0.5 text-xs font-semibold rounded-full";

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center",
        sizing,
        color,
        className,
      )}
    >
      {value}%
    </span>
  );
}
