"use client";
import type { FieldProps } from "./QuestionRenderer";

export function SelectInput({ question, value, onChange }: FieldProps) {
  const current = typeof value === "string" ? value : "";

  return (
    <select
      value={current}
      aria-label={question.text || question.label}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border border-neutral-200 bg-neutral-50 px-3.5 py-2.5 text-sm leading-snug outline-none transition focus:border-[#534AB7] focus:ring-1 focus:ring-[#534AB7]"
    >
      <option value="" disabled>
        Seleziona…
      </option>
      {(question.selectOptions ?? []).map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  );
}
