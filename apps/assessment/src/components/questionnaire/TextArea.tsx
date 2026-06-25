"use client";
import type { FieldProps } from "./QuestionRenderer";

export function TextArea({ question, value, onChange }: FieldProps) {
  const current = typeof value === "string" ? value : "";

  return (
    <textarea
      value={current}
      placeholder={question.placeholder ?? ""}
      onChange={(e) => onChange(e.target.value)}
      rows={4}
      className="w-full rounded-md border border-neutral-200 bg-neutral-50 px-3.5 py-2.5 text-sm leading-snug outline-none transition placeholder:text-neutral-400 focus:border-[#534AB7] focus:ring-1 focus:ring-[#534AB7]"
    />
  );
}
