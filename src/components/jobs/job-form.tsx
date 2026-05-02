"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { strings } from "@/lib/i18n/strings";
import { SkillsInput } from "./skills-input";
import { LocationCombobox } from "@/components/shared/location-combobox";

type FormState = { ok: true } | { ok: false; error: string } | null;

interface JobFormProps {
  mode: "create" | "edit";
  initial?: {
    name: string;
    locationRaw: string;
    description: string;
    skills: string[];
  };
  action: (formData: FormData) => Promise<FormState>;
}

export function JobForm({ mode, initial, action }: JobFormProps) {
  const [skills, setSkills] = useState<string[]>(initial?.skills ?? []);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    form.set("skills", JSON.stringify(skills));
    startTransition(async () => {
      const result = await action(form);
      if (result && result.ok === false) {
        setError(result.error);
      } else {
        router.refresh();
      }
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-6 max-w-2xl">
      <div className="space-y-2">
        <Label htmlFor="name">{strings.jobs.fieldName}</Label>
        <Input
          id="name"
          name="name"
          defaultValue={initial?.name}
          required
          maxLength={120}
          className="bg-white"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="locationRaw">{strings.jobs.fieldLocation}</Label>
        <LocationCombobox
          name="locationRaw"
          defaultValue={initial?.locationRaw ?? ""}
          placeholder="es. Milano, Lombardia"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">{strings.jobs.fieldDescription}</Label>
        <Textarea
          id="description"
          name="description"
          defaultValue={initial?.description}
          rows={8}
          minLength={20}
          maxLength={5000}
          className="bg-white"
          required
        />
      </div>

      <div className="space-y-2">
        <Label>{strings.jobs.fieldSkills}</Label>
        <SkillsInput value={skills} onChange={setSkills} />
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          {mode === "create" ? strings.jobs.createButton : strings.jobs.updateButton}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          {strings.common.cancel}
        </Button>
      </div>
    </form>
  );
}
