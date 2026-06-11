"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/provider";
import type { Locale } from "@/lib/i18n/types";

interface LanguageFormProps {
  defaultLanguage: Locale;
  action: (formData: FormData) => Promise<void>;
}

export function LanguageForm({ defaultLanguage, action }: LanguageFormProps) {
  const t = useT();
  const [language, setLanguage] = useState<Locale>(defaultLanguage);

  const [_state, formAction, isPending] = useActionState(
    async (_prev: unknown, formData: FormData) => {
      await action(formData);
      return { success: true };
    },
    null,
  );

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1">
        <label className="text-sm text-muted-foreground">{t.profile.language}</label>
        <select
          name="language"
          value={language}
          onChange={(e) => setLanguage(e.target.value as Locale)}
          className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="it">{t.profile.italian}</option>
          <option value="en">{t.profile.english}</option>
        </select>
      </div>
      <Button type="submit" size="sm" disabled={isPending}>
        {t.common.save}
      </Button>
    </form>
  );
}
