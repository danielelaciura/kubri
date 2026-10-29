import { cache } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { I18nProvider } from "@/lib/i18n/provider";
import { getDictionary } from "@/lib/i18n";
import { getActiveLandingBySlug } from "@/lib/landing/service";
import { resolvePublicLocale } from "@/lib/landing/locale";
import { buildWaLink } from "@/lib/whatsapp/build-link";
import { LandingFlow } from "@/components/landing/landing-flow";

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
  const [{ slug }, sp, h] = await Promise.all([params, searchParams, headers()]);
  const landing = await getLanding(slug);
  if (!landing) notFound();
  return { landing, locale: resolvePublicLocale(sp.lang, h.get("accept-language")) };
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

  return (
    <I18nProvider locale={locale}>
      <main lang={locale} className="mx-auto w-full max-w-2xl flex-1 space-y-6 px-4 py-10">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl tracking-tight">{landing.organization.name}</h1>
            <p className="mt-1 text-muted-foreground">
              {t.intro.replace("{org}", landing.organization.name)}
            </p>
          </div>
          <a
            href={`?lang=${otherLocale}`} className="text-sm underline" hrefLang={otherLocale}
            aria-label={`${t.languageLabel}: ${otherLocale.toUpperCase()}`}
          >
            {otherLocale.toUpperCase()}
          </a>
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
