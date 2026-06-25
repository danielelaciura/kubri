"use client";
import type { SubFieldDef } from "@kubri/contracts";
import type { FieldProps } from "./QuestionRenderer";
import { SingleChoice } from "./SingleChoice";
import { MultiChoice } from "./MultiChoice";
import { Scale } from "./Scale";
import { TextInput } from "./TextInput";
import { TextArea } from "./TextArea";
import { SelectInput } from "./SelectInput";

type Entry = Record<string, unknown>;

function SubFieldInput({
  field,
  value,
  onChange,
}: {
  field: SubFieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  // Adapt SubFieldDef → the QuestionDef shape expected by each leaf component.
  // Only the render-config fields are needed; we cast via `as` since SubFieldDef
  // intentionally omits `text`, `hint`, `fields`, and `target`.
  const question = field as unknown as Parameters<typeof SingleChoice>[0]["question"];

  switch (field.component) {
    case "single_choice":
      return <SingleChoice question={question} value={value} onChange={onChange} />;
    case "multi_choice":
      return <MultiChoice question={question} value={value} onChange={onChange} />;
    case "scale":
      return <Scale question={question} value={value} onChange={onChange} />;
    case "text":
      return <TextInput question={question} value={value} onChange={onChange} />;
    case "textarea":
      return <TextArea question={question} value={value} onChange={onChange} />;
    case "select":
      return <SelectInput question={question} value={value} onChange={onChange} />;
  }
}

export function RepeatableGroup({ question, value, onChange }: FieldProps) {
  const entries: Entry[] = Array.isArray(value) ? (value as Entry[]) : [];
  const fields: SubFieldDef[] = question.fields ?? [];

  function updateEntry(index: number, fieldId: string, fieldValue: unknown) {
    const next = entries.map((entry, i) =>
      i === index ? { ...entry, [fieldId]: fieldValue } : entry,
    );
    onChange(next);
  }

  function addEntry() {
    onChange([...entries, {}]);
  }

  function removeEntry(index: number) {
    onChange(entries.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-3">
      {entries.map((entry, index) => (
        <div
          key={index}
          className="rounded-md border border-neutral-200 bg-white p-4"
        >
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-medium text-neutral-500">
              #{index + 1}
            </span>
            <button
              type="button"
              onClick={() => removeEntry(index)}
              className="rounded p-1 text-xs text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-600"
              aria-label="Rimuovi"
            >
              ✕
            </button>
          </div>
          <div className="flex flex-col gap-3">
            {fields.map((field) => (
              <div key={field.id}>
                <label className="mb-1 block text-xs font-medium text-neutral-600">
                  {field.label}
                </label>
                <SubFieldInput
                  field={field}
                  value={entry[field.id]}
                  onChange={(v) => updateEntry(index, field.id, v)}
                />
              </div>
            ))}
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={addEntry}
        className="rounded-md border border-dashed border-[#AFA9EC] bg-[#EEEDFE] px-4 py-2.5 text-sm font-medium text-[#3C3489] transition hover:border-[#534AB7] hover:bg-[#E4E2FC]"
      >
        + Aggiungi esperienza
      </button>
    </div>
  );
}
