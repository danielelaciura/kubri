"use client";

import { useProgressRouter } from "@/components/layout/route-progress";
import { TableRow } from "@/components/ui/table";

export function JobTableRow({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const router = useProgressRouter();
  return (
    <TableRow
      className="cursor-pointer hover:bg-muted/50"
      onClick={() => router.push(href)}
    >
      {children}
    </TableRow>
  );
}
