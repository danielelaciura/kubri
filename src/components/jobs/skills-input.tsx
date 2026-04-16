"use client";

import { useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { strings } from "@/lib/i18n/strings";

interface SkillsInputProps {
  value: string[];
  onChange: (next: string[]) => void;
  name?: string;
}

export function SkillsInput({ value, onChange, name }: SkillsInputProps) {
  const [draft, setDraft] = useState("");

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (value.includes(trimmed)) {
      setDraft("");
      return;
    }
    onChange([...value, trimmed]);
    setDraft("");
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit();
    } else if (e.key === "Backspace" && !draft && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  const remove = (skill: string) => onChange(value.filter((s) => s !== skill));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {value.map((skill) => (
          <Badge key={skill} variant="secondary" className="gap-1 pr-1">
            {skill}
            <button
              type="button"
              onClick={() => remove(skill)}
              className="rounded-full p-0.5 hover:bg-muted"
              aria-label={`Rimuovi ${skill}`}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
      </div>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        onBlur={commit}
        placeholder={strings.jobs.skillPlaceholder}
      />
      {name && <input type="hidden" name={name} value={JSON.stringify(value)} />}
    </div>
  );
}
