"use client";
import type { FieldProps } from "./QuestionRenderer";

export function SingleChoice({ question, value, onChange }: FieldProps) {
  return (
    <div
      role="group"
      aria-label={question.text || question.label}
      className="grid grid-cols-1 gap-2 sm:grid-cols-2"
    >
      {(question.options ?? []).map((o) => {
        const isSelected = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onChange(o.value)}
            className={`rounded-md border px-3.5 py-2.5 text-left text-sm leading-snug transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#534AB7] focus-visible:ring-offset-1 ${
              isSelected
                ? "border-[#534AB7] bg-[#EEEDFE] font-medium text-[#3C3489]"
                : "border-neutral-200 bg-neutral-50 hover:border-[#AFA9EC]"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
