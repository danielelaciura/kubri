"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/provider";

interface NotificationFormProps {
  defaultEnabled: boolean;
  defaultFrequency: "DAILY" | "WEEKLY";
  action: (formData: FormData) => Promise<void>;
}

export function NotificationForm({
  defaultEnabled,
  defaultFrequency,
  action,
}: NotificationFormProps) {
  // Controlled inputs: React 19 resets a form after its action runs, which would
  // otherwise revert uncontrolled fields to a stale defaultValue before the
  // revalidated props arrive. State-backed values stay in sync after saving.
  const t = useT();
  const [enabled, setEnabled] = useState(defaultEnabled);
  const [frequency, setFrequency] = useState<"DAILY" | "WEEKLY">(
    defaultFrequency,
  );

  const [_state, formAction, isPending] = useActionState(
    async (_prev: unknown, formData: FormData) => {
      await action(formData);
      return { success: true };
    },
    null,
  );

  return (
    <form action={formAction} className="space-y-4">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="notifyEnabled"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-4 w-4"
        />
        {t.settings.notificationsEnable}
      </label>

      <div className="space-y-1">
        <label className="text-sm text-muted-foreground">
          {t.settings.frequency}
        </label>
        <select
          name="notifyFrequency"
          value={frequency}
          onChange={(e) => setFrequency(e.target.value as "DAILY" | "WEEKLY")}
          className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="DAILY">{t.settings.frequencyDaily}</option>
          <option value="WEEKLY">{t.settings.frequencyWeekly}</option>
        </select>
      </div>

      <Button type="submit" size="sm" disabled={isPending}>
        {t.common.save}
      </Button>
    </form>
  );
}
