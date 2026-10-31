import { cache } from "react";
import Image from "next/image";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { I18nProvider } from "@/lib/i18n/provider";
import { getDictionary } from "@/lib/i18n";
import { getActiveLandingBySlug } from "@/lib/landing/service";
import { resolvePublicLocale } from "@/lib/landing/locale";
import { buildWaLink } from "@/lib/whatsapp/build-link";
import { LandingFlow } from "@/components/landing/landing-flow";
import { LocaleFlag } from "@/components/landing/locale-flag";

// Route segment config: server actions invoked from this page (CV extraction)
// inherit this budget (Next 16 docs, route-segment-config/maxDuration).
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// One lookup per request, shared by generateMetadata and the page.
const getLanding = cache(getActiveLandingBySlug);

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ lang?: string | string[] }>;
}

async function resolve({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const landing = await getLanding(slug);
  if (!landing) notFound();
  return { landing, locale: resolvePublicLocale(sp.lang) };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { landing, locale } = await resolve(props);
  const t = getDictionary(locale).landing;
  // Shared by link/QR only; keep it out of search engines (less bot traffic).
  return { title: t.metaTitle.replace("{org}", landing.organization.name), robots: { index: false, follow: false } };
}

export default async function CandidateLandingPage(props: Props) {
  const { landing, locale } = await resolve(props);
  const t = getDictionary(locale).landing;

  // Built server-side: the pool (externalKey, globalSharing) never reaches the client.
  const waNumber = process.env.KUBRI_WHATSAPP_NUMBER ?? "";
  const waTemplate = process.env.KUBRI_WHATSAPP_MESSAGE_TEMPLATE ?? "";
  const waLink = waNumber && waTemplate ? buildWaLink(landing.pool, waNumber, waTemplate) : null;
  const otherLocale = locale === "it" ? "en" : "it";
  // The switcher names the other language in that language ("English" / "Italiano").
  const otherLanguageName = getDictionary(otherLocale).landing.languageName;

  return (
    <I18nProvider locale={locale}>
      {/* White top bar: Kubri wordmark on the left, language switch on the right. */}
      <div className="border-b bg-white">
        <div className="mx-auto flex h-6 w-full max-w-2xl items-center justify-between px-4">
          <Image src="/kubri-wordmark.png" alt="Kubri" width={56} height={16} priority className="h-4 w-auto" />
          <a
            href={`?lang=${otherLocale}`} hrefLang={otherLocale} lang={otherLocale}
            className="inline-flex items-center gap-1.5 text-xs text-neutral-700 hover:text-neutral-950 hover:underline"
            aria-label={`${t.languageLabel}: ${otherLanguageName}`}
          >
            <LocaleFlag locale={otherLocale} className="h-2.5 w-3.5 rounded-[1px] shadow-[0_0_0_1px_rgb(0_0_0/0.1)]" />
            {otherLanguageName}
          </a>
        </div>
      </div>
      <main lang={locale} className="mx-auto w-full max-w-2xl flex-1 space-y-6 px-4 py-10">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            {t.headline.replace("{org}", landing.organization.name)}
          </h1>
          <p className="max-w-prose text-pretty text-muted-foreground">{t.intro}</p>
        </header>
        <LandingFlow
          slug={landing.slug}
          locale={locale}
          orgName={landing.organization.name}
          waLink={waLink}
          privacyPolicyUrl={landing.privacyPolicyUrl}
          showShare={landing.pool.globalSharing === "WEBHOOK"}
          turnstileSiteKey={process.env.TURNSTILE_SITE_KEY ?? ""}
        />
      </main>
    </I18nProvider>
  );
}
