"use client";
import type { FieldProps } from "./QuestionRenderer";

export function MultiChoice({ question, value, onChange }: FieldProps) {
  const selected: string[] = Array.isArray(value) ? (value as string[]) : [];

  function toggle(optValue: string) {
    if (selected.includes(optValue)) {
      onChange(selected.filter((v) => v !== optValue));
    } else {
      onChange([...selected, optValue]);
    }
  }

  return (
    <div
      role="group"
      aria-label={question.text || question.label}
      className="grid grid-cols-1 gap-2 sm:grid-cols-2"
    >
      {(question.options ?? []).map((o) => {
        const isSelected = selected.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={isSelected}
            onClick={() => toggle(o.value)}
            className={`flex items-center gap-2.5 rounded-md border px-3.5 py-2.5 text-left text-sm leading-snug transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#534AB7] focus-visible:ring-offset-1 ${
              isSelected
                ? "border-[#534AB7] bg-[#EEEDFE] font-medium text-[#3C3489]"
                : "border-neutral-200 bg-neutral-50 hover:border-[#AFA9EC]"
            }`}
          >
            <span
              className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border transition ${
                isSelected
                  ? "border-[#534AB7] bg-[#534AB7] text-white"
                  : "border-neutral-300 bg-white"
              }`}
              aria-hidden="true"
            >
              {isSelected && (
                <svg
                  viewBox="0 0 10 8"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-2 w-2"
                >
                  <path
                    d="M1 4l2.5 2.5L9 1"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </span>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
