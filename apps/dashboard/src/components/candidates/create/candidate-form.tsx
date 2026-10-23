"use client";

import { useState, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import type { CandidateDraftFields, CandidateFieldKey, CandidateFieldsInput } from "@kubri/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LoadingButton } from "@/components/shared/loading-button";
import { useProgressTransition } from "@/components/layout/route-progress";
import { useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { ActionResult, FieldErrors } from "@/app/(dashboard)/dashboard/candidates/new/actions";
import { toFormState, toSubmission, validateFormState, type FormState, type TriState } from "./form-state";

export interface PoolOption {
  id: string;
  name: string;
}

interface CandidateFormProps {
  initialValues: CandidateDraftFields;
  /** Fields the extraction marked as uncertain (amber + "da verificare"). */
  uncertain?: CandidateFieldKey[];
  /** Shown as a select only when there is more than one pool. */
  pools: PoolOption[];
  onSubmit: (poolId: string, values: CandidateFieldsInput) => Promise<ActionResult<{ candidateId: string }>>;
  onSuccess: (candidateId: string) => void;
  /** Extra header actions (e.g. "Scarta" on the review page). */
  secondaryActions?: ReactNode;
}

type TextKey = Exclude<
  CandidateFieldKey,
  "workingPermit" | "drivingLicense" | "partTimePreference" |
  "educationAndTraining" | "workExperience" | "skillsAndCompetences" | "additionalLanguages"
>;
type ListKey = "educationAndTraining" | "workExperience" | "skillsAndCompetences" | "additionalLanguages";
type BoolKey = "workingPermit" | "drivingLicense" | "partTimePreference";

export function CandidateForm({
  initialValues,
  uncertain = [],
  pools,
  onSubmit,
  onSuccess,
  secondaryActions,
}: CandidateFormProps) {
  const t = useT();
  const tc = t.candidateCreate;
  const [state, setState] = useState<FormState>(() => toFormState(initialValues));
  const [poolId, setPoolId] = useState(pools[0]?.id ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useProgressTransition();

  const set = <K extends CandidateFieldKey>(key: K, value: FormState[K]) => {
    setState((s) => ({ ...s, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const fieldClass = (key: CandidateFieldKey) =>
    cn(
      errors[key] && "border-destructive",
      !errors[key] && uncertain.includes(key) && "border-amber-400 bg-amber-50/40",
    );

  const label = (k: CandidateFieldKey, required?: boolean) => (
    <Label htmlFor={`cf-${k}`} className="flex items-center gap-1 text-sm">
      {tc.fields[k]}
      {required && <span aria-hidden="true">*</span>}
      {uncertain.includes(k) && (
        <span className="text-xs font-normal text-amber-700">· {tc.toVerify}</span>
      )}
    </Label>
  );

  const fieldError = (k: CandidateFieldKey) =>
    errors[k] ? (
      <p className="text-xs text-destructive">
        {errors[k] === "required" ? tc.fieldRequired : tc.fieldInvalid}
      </p>
    ) : null;

  const text = (k: TextKey, opts: { required?: boolean; multiline?: boolean; type?: string } = {}) => (
    <div className="space-y-1.5">
      {label(k, opts.required)}
      {opts.multiline ? (
        <Textarea id={`cf-${k}`} value={state[k]} onChange={(e) => set(k, e.target.value)} className={fieldClass(k)} aria-invalid={!!errors[k]} rows={2} />
      ) : (
        <Input id={`cf-${k}`} type={opts.type ?? "text"} value={state[k]} onChange={(e) => set(k, e.target.value)} className={fieldClass(k)} aria-invalid={!!errors[k]} />
      )}
      {fieldError(k)}
    </div>
  );

  const bool = (k: BoolKey) => (
    <div className="space-y-1.5">
      {label(k)}
      <select
        id={`cf-${k}`}
        value={state[k]}
        aria-invalid={!!errors[k]}
        onChange={(e) => set(k, e.target.value as TriState)}
        className={cn("h-9 w-full rounded-md border border-input bg-white px-2 text-sm", fieldClass(k))}
      >
        <option value="">{tc.notStated}</option>
        <option value="true">{tc.yes}</option>
        <option value="false">{tc.no}</option>
      </select>
      {fieldError(k)}
    </div>
  );

  const list = (k: ListKey) => (
    <div className="space-y-1.5">
      {label(k)}
      <div className={cn("space-y-2 rounded-md", uncertain.includes(k) && "ring-1 ring-amber-400 p-2")}>
        {state[k].map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              aria-label={`${tc.fields[k]} ${i + 1}`}
              aria-invalid={!!errors[k]}
              value={item}
              onChange={(e) => set(k, state[k].map((v, j) => (j === i ? e.target.value : v)))}
            />
            <Button
              type="button" variant="ghost" size="icon" aria-label={tc.removeItem}
              onClick={() => set(k, state[k].filter((_, j) => j !== i))}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button type="button" variant="ghost" size="sm" className="gap-1" onClick={() => set(k, [...state[k], ""])}>
          <Plus className="h-4 w-4" />
          {tc.addItem}
        </Button>
      </div>
      {fieldError(k)}
    </div>
  );

  const section = (title: string, children: ReactNode) => (
    <fieldset className="space-y-4">
      <legend className="mb-2 text-sm font-medium text-muted-foreground">{title}</legend>
      {children}
    </fieldset>
  );

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const clientErrors = validateFormState(state);
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors);
      setFormError(tc.errors.VALIDATION);
      return;
    }
    setFormError(null);
    startTransition(async () => {
      const res = await onSubmit(poolId, toSubmission(state));
      if (res.ok) {
        onSuccess(res.data.candidateId);
        return;
      }
      setErrors(res.fieldErrors ?? {});
      setFormError(tc.errors[res.error]);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-8" noValidate>
      {pools.length > 1 && (
        <div className="space-y-1.5">
          <Label htmlFor="cf-pool">{tc.pool}</Label>
          <select
            id="cf-pool" value={poolId} onChange={(e) => setPoolId(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-white px-2 text-sm"
          >
            {pools.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      )}

      {section(tc.sectionPersonal, (
        <div className="grid gap-4 sm:grid-cols-2">
          {text("firstName", { required: true })}
          {text("lastName", { required: true })}
          {text("birthday")}
          {text("countryOfOrigin")}
          {text("phone", { type: "tel" })}
          {text("email", { type: "email" })}
          {text("location")}
          {text("address")}
        </div>
      ))}

      {section(tc.sectionJob, (
        <div className="grid gap-4 sm:grid-cols-2">
          {text("desiredJob")}
          {text("preferredLocation")}
          {bool("partTimePreference")}
          <div className="sm:col-span-2">{text("jobConstraints", { multiline: true })}</div>
        </div>
      ))}

      {section(tc.sectionExperience, (
        <div className="space-y-4">
          {list("workExperience")}
          {list("educationAndTraining")}
          {list("skillsAndCompetences")}
        </div>
      ))}

      {section(tc.sectionLanguages, (
        <div className="grid gap-4 sm:grid-cols-2">
          {text("language")}
          {text("italianLevel")}
          <div className="sm:col-span-2">{list("additionalLanguages")}</div>
        </div>
      ))}

      {section(tc.sectionRequirements, (
        <div className="grid gap-4 sm:grid-cols-3">
          {bool("workingPermit")}
          {bool("drivingLicense")}
          {text("meanOfTransport")}
        </div>
      ))}

      {formError && <p className="text-sm text-destructive" role="alert">{formError}</p>}

      <div className="flex justify-end gap-2">
        {secondaryActions}
        <LoadingButton type="submit" loading={pending} loadingText={tc.creating}>
          {tc.create}
        </LoadingButton>
      </div>
    </form>
  );
}
