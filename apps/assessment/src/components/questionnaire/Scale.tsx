"use client";
import type { FieldProps } from "./QuestionRenderer";

export function Scale({ question, value, onChange }: FieldProps) {
  const cfg = question.scale ?? { min: 1, max: 5, default: 3, labelMin: "", labelMax: "" };
  const current = typeof value === "number" ? value : cfg.default;

  return (
    <div className="flex flex-col gap-3">
      <div className="text-center text-4xl font-semibold text-[#534AB7]">{current}</div>
      <input
        type="range"
        min={cfg.min}
        max={cfg.max}
        value={current}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[#534AB7]"
      />
      <div className="flex justify-between text-xs text-neutral-500">
        <span>{cfg.labelMin}</span>
        <span>{cfg.labelMax}</span>
      </div>
    </div>
  );
}
