"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/lib/i18n/provider";
import { landingContactSchema, type ContactPrefill, type LandingPrefill } from "@/lib/landing/contact";
import { PlaceField, type PlaceSelection } from "./place-field";

export interface ContactSubmission extends ContactPrefill {
  privacyAccepted: boolean;
  shareWithGlobal: boolean;
  placeId: string;
  placeSessionToken: string | undefined;
}

type FieldKey = keyof ContactPrefill | "placeId" | "privacyAccepted";
const FIELD_ORDER: FieldKey[] = ["firstName", "lastName", "phone", "email", "placeId", "privacyAccepted"];
const MAX_LENGTH: Record<keyof ContactPrefill, number> = {
  firstName: 100,
  lastName: 100,
  phone: 40,
  email: 254,
};

export function ContactForm({
  slug,
  orgName,
  prefill,
  privacyPolicyUrl,
  showShare,
  busy,
  placeResetKey,
  onSubmit,
}: {
  slug: string;
  orgName: string;
  prefill: LandingPrefill;
  privacyPolicyUrl: string;
  showShare: boolean;
  busy: boolean;
  /** Bumped by the parent when the server rejects the chosen place. */
  placeResetKey: number;
  onSubmit: (values: ContactSubmission) => void;
}) {
  const t = useT().landing;
  const [values, setValues] = useState<ContactPrefill>({
    firstName: prefill.firstName,
    lastName: prefill.lastName,
    phone: prefill.phone,
    email: prefill.email,
  });
  const [place, setPlace] = useState<PlaceSelection | null>(prefill.place);
  // Reset the selection when the parent asks (adjusting state during render).
  const [seenResetKey, setSeenResetKey] = useState(placeResetKey);
  if (seenResetKey !== placeResetKey) {
    setSeenResetKey(placeResetKey);
    setPlace(null);
  }
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [shareWithGlobal, setShareWithGlobal] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const org = (s: string) => s.replace("{org}", orgName);

  function validate(): boolean {
    const parsed = landingContactSchema.safeParse({
      ...values, privacyAccepted, shareWithGlobal,
      placeId: place?.placeId ?? "", placeSessionToken: place?.sessionToken,
    });
    const e: Partial<Record<FieldKey, string>> = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const raw = issue.path[0] as FieldKey | "placeSessionToken" | undefined;
        // A bad session token means the place must be chosen again.
        const key: FieldKey | undefined = raw === "placeSessionToken" ? "placeId" : raw;
        if (!key || e[key]) continue;
        if (key === "phone") e.phone = values.phone.trim() ? t.phoneInvalid : t.fieldRequired;
        else if (key === "email") e.email = t.emailInvalid;
        else if (key === "privacyAccepted") e.privacyAccepted = t.privacyRequired;
        else if (key === "placeId") e.placeId = t.placeRequired;
        else e[key] = t.fieldRequired;
      }
    }
    setErrors(e);
    const first = FIELD_ORDER.find((k) => e[k]);
    if (first) document.getElementById(`landing-${first}`)?.focus();
    return !first;
  }

  function field(key: keyof ContactPrefill, label: string, type = "text", autoComplete?: string) {
    const id = `landing-${key}`;
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id}>{label}</Label>
        <Input
          id={id} type={type} maxLength={MAX_LENGTH[key]} autoComplete={autoComplete} value={values[key]}
          aria-invalid={errors[key] ? true : undefined}
          aria-describedby={errors[key] ? `${id}-error` : undefined}
          onChange={(ev) => setValues((v) => ({ ...v, [key]: ev.target.value }))}
        />
        {errors[key] && <p id={`${id}-error`} role="alert" className="text-sm text-destructive">{errors[key]}</p>}
      </div>
    );
  }

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(ev) => {
        ev.preventDefault();
        if (validate()) {
          onSubmit({
            ...values, privacyAccepted, shareWithGlobal,
            placeId: place!.placeId, placeSessionToken: place!.sessionToken,
          });
        }
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {field("firstName", t.firstName, "text", "given-name")}
        {field("lastName", t.lastName, "text", "family-name")}
      </div>
      {field("phone", t.phone, "tel", "tel")}
      {field("email", t.email, "email", "email")}
      <div className="space-y-1.5">
        <Label htmlFor="landing-placeId">{t.placeLabel}</Label>
        <PlaceField
          key={placeResetKey} slug={slug} value={place} onChange={setPlace} invalid={Boolean(errors.placeId)}
          describedBy={errors.placeId ? "landing-placeId-hint landing-placeId-error" : "landing-placeId-hint"}
        />
        <p id="landing-placeId-hint" className="text-xs text-muted-foreground">{t.placeHint}</p>
        {errors.placeId && <p id="landing-placeId-error" role="alert" className="text-sm text-destructive">{errors.placeId}</p>}
      </div>

      <div className="space-y-1.5">
        <label className="flex items-start gap-2 text-sm">
          <input
            id="landing-privacyAccepted" type="checkbox" className="mt-1 h-4 w-4" checked={privacyAccepted}
            aria-invalid={errors.privacyAccepted ? true : undefined}
            aria-describedby={errors.privacyAccepted ? "landing-privacyAccepted-error" : undefined}
            onChange={(ev) => setPrivacyAccepted(ev.target.checked)}
          />
          <span>
            {org(t.privacyLabel)}{" "}
            <a href={privacyPolicyUrl} target="_blank" rel="noreferrer" className="underline">
              {t.privacyLink}
            </a>
          </span>
        </label>
        {errors.privacyAccepted && <p id="landing-privacyAccepted-error" role="alert" className="text-sm text-destructive">{errors.privacyAccepted}</p>}
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

      <Button type="submit" className="h-11 w-full text-base" disabled={busy}>
        {busy ? t.submitting : t.submit}
      </Button>
    </form>
  );
}
