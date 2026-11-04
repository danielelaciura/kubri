"use client";

import { useActionState } from "react";
import { saveLandingPageAction } from "@/lib/landing/admin-actions";
import type { SaveLandingState } from "@/lib/landing/admin-types";
import { SubmitButton } from "@/components/shared/loading-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  LANDING_BRAND_NAME_MAX,
  LANDING_SUBTITLE_MAX,
  LANDING_TAGLINE_MAX,
  LANDING_TITLE_MAX,
} from "@/lib/validations/landing-page";
import { useT } from "@/lib/i18n/provider";

interface Props {
  organizationId: string;
  pools: { id: string; name: string }[];
  initial: {
    slug: string;
    poolId: string;
    privacyPolicyUrl: string;
    enabled: boolean;
    exists: boolean;
    titleIt: string;
    titleEn: string;
    subtitleIt: string;
    subtitleEn: string;
    brandName: string;
    taglineIt: string;
    taglineEn: string;
    logoUrl: string | null;
    hasLogo: boolean;
  };
}

const IDLE: SaveLandingState = { status: "idle" };

export function LandingAdminForm({ organizationId, pools, initial }: Props) {
  const t = useT().landingAdmin;
  const [state, action] = useActionState(saveLandingPageAction.bind(null, organizationId), IDLE);

  return (
    <form action={action} className="grid gap-3 md:grid-cols-2">
      <label className="space-y-1 text-sm">
        <span>{t.slug}</span>
        <Input
          name="slug"
          defaultValue={initial.slug}
          required
          minLength={3}
          maxLength={60}
          pattern="[a-z0-9][a-z0-9\-]{1,58}[a-z0-9]"
        />
        <span className="block text-xs text-muted-foreground">{t.slugHint}</span>
        {initial.exists && (
          <span className="block text-xs text-amber-700 dark:text-amber-400">{t.slugChangeWarning}</span>
        )}
      </label>
      <label className="space-y-1 text-sm">
        <span>{t.pool}</span>
        <select
          name="poolId"
          required
          defaultValue={initial.poolId}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
        >
          {pools.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1 text-sm md:col-span-2">
        <span>{t.privacyPolicyUrl}</span>
        <Input
          name="privacyPolicyUrl"
          type="url"
          placeholder="https://"
          defaultValue={initial.privacyPolicyUrl}
        />
        <span className="block text-xs text-muted-foreground">{t.privacyPolicyUrlHint}</span>
      </label>
      <fieldset className="space-y-2 md:col-span-2">
        <legend className="mb-1 text-sm font-medium">{t.logoLegend}</legend>
        <div className="flex items-center gap-3">
          {initial.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- admin preview of our own route
            <img src={initial.logoUrl} alt="" className="size-11 rounded-lg border bg-white object-contain" />
          ) : (
            <span className="text-xs text-muted-foreground">{initial.hasLogo ? t.logoSavedHidden : t.logoNone}</span>
          )}
          <Input name="logo" type="file" accept="image/png,image/jpeg" className="max-w-xs" />
        </div>
        <span className="block text-xs text-muted-foreground">{t.logoHint}</span>
        <label className="block max-w-md space-y-1 text-sm">
          <span>{t.brandName}</span>
          <Input name="brandName" required maxLength={LANDING_BRAND_NAME_MAX} defaultValue={initial.brandName} />
        </label>
        {initial.hasLogo && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="removeLogo" className="h-4 w-4" />
            {t.logoRemove}
          </label>
        )}
      </fieldset>
      <fieldset className="grid gap-3 md:col-span-2 md:grid-cols-2">
        <legend className="mb-1 text-sm font-medium">{t.textsLegend}</legend>
        {(["It", "En"] as const).map((lang) => (
          <div key={lang} className="space-y-3">
            <label className="block space-y-1 text-sm">
              <span>{lang === "It" ? t.titleIt : t.titleEn}</span>
              <Input name={`title${lang}`} required maxLength={LANDING_TITLE_MAX} defaultValue={initial[`title${lang}`]} />
            </label>
            <label className="block space-y-1 text-sm">
              <span>{lang === "It" ? t.taglineIt : t.taglineEn}</span>
              <Input
                name={`tagline${lang}`} maxLength={LANDING_TAGLINE_MAX} defaultValue={initial[`tagline${lang}`]}
                placeholder={lang === "It" ? t.taglinePlaceholderIt : t.taglinePlaceholderEn}
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span>{lang === "It" ? t.subtitleIt : t.subtitleEn}</span>
              <Textarea
                name={`subtitle${lang}`} rows={2} maxLength={LANDING_SUBTITLE_MAX}
                defaultValue={initial[`subtitle${lang}`]}
              />
            </label>
          </div>
        ))}
        <p className="text-xs text-muted-foreground md:col-span-2">{t.textsHint}</p>
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="enabled" defaultChecked={initial.enabled} className="h-4 w-4" />
        {t.enabled}
      </label>
      <div className="space-y-2 md:col-span-2">
        <SubmitButton>{t.save}</SubmitButton>
        {state.status === "error" && state.error && (
          <p role="alert" className="text-sm text-destructive">
            {t.errors[state.error]}
          </p>
        )}
        {state.status === "saved" && (
          <p role="status" className="text-sm text-green-700 dark:text-green-400">
            {t.saved}
          </p>
        )}
      </div>
    </form>
  );
}
