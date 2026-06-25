"use client";
import type { FieldProps } from "./QuestionRenderer";

export function SingleChoice({ question, value, onChange }: FieldProps) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {(question.options ?? []).map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-md border px-3.5 py-2.5 text-left text-sm leading-snug transition ${
            value === o.value
              ? "border-[#534AB7] bg-[#EEEDFE] font-medium text-[#3C3489]"
              : "border-neutral-200 bg-neutral-50 hover:border-[#AFA9EC]"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
