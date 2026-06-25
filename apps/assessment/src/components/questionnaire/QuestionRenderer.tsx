"use client";
import type { QuestionDef } from "@kubri/contracts";
import { SingleChoice } from "./SingleChoice";
import { MultiChoice } from "./MultiChoice";
import { Scale } from "./Scale";
import { TextInput } from "./TextInput";
import { TextArea } from "./TextArea";
import { SelectInput } from "./SelectInput";
import { RepeatableGroup } from "./RepeatableGroup";

export interface FieldProps {
  question: QuestionDef;
  value: unknown;
  onChange: (value: unknown) => void;
}

export function QuestionRenderer({ question, value, onChange }: FieldProps) {
  switch (question.component) {
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
    case "repeatable_group":
      return <RepeatableGroup question={question} value={value} onChange={onChange} />;
  }
}
