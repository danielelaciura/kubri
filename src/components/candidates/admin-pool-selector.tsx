"use client";

import { useRouter, useSearchParams } from "next/navigation";

interface AdminPoolSelectorProps {
  pools: { id: string; name: string }[];
  activePoolId?: string;
}

export function AdminPoolSelector({ pools, activePoolId }: AdminPoolSelectorProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const onChange = (poolId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("poolId", poolId);
    params.delete("page");
    router.push(`/dashboard/candidates?${params.toString()}`);
  };

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium text-muted-foreground">Pool:</span>
      <select
        value={activePoolId ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-input bg-white px-2 py-1 text-sm"
      >
        {pools.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  );
}
