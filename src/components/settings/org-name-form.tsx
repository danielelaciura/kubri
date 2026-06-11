"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/lib/i18n/provider";

interface OrgNameFormProps {
  currentName: string;
  action: (formData: FormData) => Promise<void>;
}

export function OrgNameForm({ currentName, action }: OrgNameFormProps) {
  const t = useT();
  const [_state, formAction, isPending] = useActionState(
    async (_prev: unknown, formData: FormData) => {
      await action(formData);
      return { success: true };
    },
    null,
  );

  return (
    <form action={formAction} className="flex items-end gap-2">
      <div className="flex-1">
        <Input
          name="name"
          defaultValue={currentName}
          placeholder={t.settings.orgName}
        />
      </div>
      <Button type="submit" size="sm" disabled={isPending}>
        {t.common.save}
      </Button>
    </form>
  );
}
