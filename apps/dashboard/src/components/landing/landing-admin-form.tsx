"use client";

import { useActionState } from "react";
import { saveLandingPageAction } from "@/lib/landing/admin-actions";
import type { SaveLandingState } from "@/lib/landing/admin-types";
import { SubmitButton } from "@/components/shared/loading-button";
import { Input } from "@/components/ui/input";
import { useT } from "@/lib/i18n/provider";

interface Props {
  organizationId: string;
  pools: { id: string; name: string }[];
  initial: {
    slug: string;
    poolId: string;
    privacyPolicyUrl: string;
    enabled: boolean;
    exists: boolean;
  };
}

const IDLE: SaveLandingState = { status: "idle" };

export function LandingAdminForm({ organizationId, pools, initial }: Props) {
  const t = useT().landingAdmin;
  const [state, action] = useActionState(saveLandingPageAction.bind(null, organizationId), IDLE);

  return (
    <form action={action} className="grid gap-3 md:grid-cols-2">
      <label className="space-y-1 text-sm">
        <span>{t.slug}</span>
        <Input
          name="slug"
          defaultValue={initial.slug}
          required
          minLength={3}
          maxLength={60}
          pattern="[a-z0-9][a-z0-9\-]{1,58}[a-z0-9]"
        />
        <span className="block text-xs text-muted-foreground">{t.slugHint}</span>
        {initial.exists && (
          <span className="block text-xs text-amber-700 dark:text-amber-400">{t.slugChangeWarning}</span>
        )}
      </label>
      <label className="space-y-1 text-sm">
        <span>{t.pool}</span>
        <select
          name="poolId"
          required
          defaultValue={initial.poolId}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
        >
          {pools.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1 text-sm md:col-span-2">
        <span>{t.privacyPolicyUrl}</span>
        <Input
          name="privacyPolicyUrl"
          type="url"
          required
          placeholder="https://"
          defaultValue={initial.privacyPolicyUrl}
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="enabled" defaultChecked={initial.enabled} className="h-4 w-4" />
        {t.enabled}
      </label>
      <div className="space-y-2 md:col-span-2">
        <SubmitButton>{t.save}</SubmitButton>
        {state.status === "error" && state.error && (
          <p role="alert" className="text-sm text-destructive">
            {t.errors[state.error]}
          </p>
        )}
        {state.status === "saved" && (
          <p role="status" className="text-sm text-green-700 dark:text-green-400">
            {t.saved}
          </p>
        )}
      </div>
    </form>
  );
}
