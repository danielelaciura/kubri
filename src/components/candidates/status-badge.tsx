import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { InterviewStatus } from "@/types";

const STATUS_CONFIG: Record<InterviewStatus, { label: string; className: string }> = {
  completed: {
    label: "Completata",
    className: "bg-green-100 text-green-800 hover:bg-green-100",
  },
  in_progress: {
    label: "In corso",
    className: "bg-yellow-100 text-yellow-800 hover:bg-yellow-100",
  },
  abandoned: {
    label: "Abbandonata",
    className: "bg-red-100 text-red-800 hover:bg-red-100",
  },
  incomplete: {
    label: "Incompleta",
    className: "bg-gray-100 text-gray-800 hover:bg-gray-100",
  },
};

interface StatusBadgeProps {
  status: InterviewStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  return (
    <Badge variant="secondary" className={cn(config.className, className)}>
      {config.label}
    </Badge>
  );
}
