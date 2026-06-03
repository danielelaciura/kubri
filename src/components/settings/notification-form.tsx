"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { strings } from "@/lib/i18n/strings";

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
          defaultChecked={defaultEnabled}
          className="h-4 w-4"
        />
        {strings.settings.notificationsEnable}
      </label>

      <div className="space-y-1">
        <label className="text-sm text-muted-foreground">
          {strings.settings.frequency}
        </label>
        <select
          name="notifyFrequency"
          defaultValue={defaultFrequency}
          className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="DAILY">{strings.settings.frequencyDaily}</option>
          <option value="WEEKLY">{strings.settings.frequencyWeekly}</option>
        </select>
      </div>

      <Button type="submit" size="sm" disabled={isPending}>
        {strings.common.save}
      </Button>
    </form>
  );
}
