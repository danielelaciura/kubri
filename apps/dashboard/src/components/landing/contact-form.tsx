"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/lib/i18n/provider";
import { normalizePhone } from "@/lib/candidates/phone";
import type { ContactPrefill } from "@/lib/landing/contact";

export interface ContactSubmission extends ContactPrefill {
  privacyAccepted: boolean;
  shareWithGlobal: boolean;
}

type FieldKey = keyof ContactPrefill | "privacyAccepted";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ContactForm({
  orgName,
  prefill,
  privacyPolicyUrl,
  showShare,
  busy,
  onSubmit,
}: {
  orgName: string;
  prefill: ContactPrefill;
  privacyPolicyUrl: string;
  showShare: boolean;
  busy: boolean;
  onSubmit: (values: ContactSubmission) => void;
}) {
  const t = useT().landing;
  const [values, setValues] = useState<ContactPrefill>(prefill);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [shareWithGlobal, setShareWithGlobal] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const org = (s: string) => s.replace("{org}", orgName);

  function validate(): boolean {
    const e: Partial<Record<FieldKey, string>> = {};
    if (!values.firstName.trim()) e.firstName = t.fieldRequired;
    if (!values.lastName.trim()) e.lastName = t.fieldRequired;
    if (!values.phone.trim()) e.phone = t.fieldRequired;
    else if (!normalizePhone(values.phone)) e.phone = t.phoneInvalid;
    if (values.email.trim() && !EMAIL_RE.test(values.email.trim())) e.email = t.emailInvalid;
    if (!privacyAccepted) e.privacyAccepted = t.privacyRequired;
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function field(key: keyof ContactPrefill, label: string, type = "text", autoComplete?: string) {
    const id = `landing-${key}`;
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id}>{label}</Label>
        <Input
          id={id} type={type} autoComplete={autoComplete} value={values[key]}
          aria-invalid={errors[key] ? true : undefined}
          aria-describedby={errors[key] ? `${id}-error` : undefined}
          onChange={(ev) => setValues((v) => ({ ...v, [key]: ev.target.value }))}
        />
        {errors[key] && <p id={`${id}-error`} className="text-sm text-destructive">{errors[key]}</p>}
      </div>
    );
  }

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(ev) => {
        ev.preventDefault();
        if (validate()) onSubmit({ ...values, privacyAccepted, shareWithGlobal });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {field("firstName", t.firstName, "text", "given-name")}
        {field("lastName", t.lastName, "text", "family-name")}
      </div>
      {field("phone", t.phone, "tel", "tel")}
      {field("email", t.email, "email", "email")}

      <div className="space-y-1.5">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox" className="mt-1 h-4 w-4" checked={privacyAccepted}
            onChange={(ev) => setPrivacyAccepted(ev.target.checked)}
          />
          <span>
            {org(t.privacyLabel)}{" "}
            <a href={privacyPolicyUrl} target="_blank" rel="noreferrer" className="underline">
              {t.privacyLink}
            </a>
          </span>
        </label>
        {errors.privacyAccepted && <p className="text-sm text-destructive">{errors.privacyAccepted}</p>}
      </div>

      {showShare && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox" className="mt-1 h-4 w-4" checked={shareWithGlobal}
            onChange={(ev) => setShareWithGlobal(ev.target.checked)}
          />
          <span>{t.shareLabel}</span>
        </label>
      )}

      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? t.submitting : t.submit}
      </Button>
    </form>
  );
}
