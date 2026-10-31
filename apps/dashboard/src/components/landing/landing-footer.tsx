import type { Dictionary } from "@/lib/i18n";

const SITE_URL = "https://www.kubri.it";
/** Legal identity as shown on kubri.it (not translated). */
const COMPANY = "Kubri Società Benefit S.r.l.";
const VAT_NUMBER = "03312650595";

/** Mini footer of the public landing: Kubri's site, legal links and identity. */
export function LandingFooter({ t }: { t: Dictionary["landing"] }) {
  const link = "underline-offset-4 hover:text-neutral-900 hover:underline";
  return (
    <footer aria-label={t.footerLabel} className="border-t bg-white">
      <div className="flex flex-col gap-2 px-4 py-4 text-xs text-neutral-600 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <nav className="flex flex-wrap gap-x-4 gap-y-1">
          <a href={SITE_URL} target="_blank" rel="noreferrer" className={link}>kubri.it</a>
          <a href={`${SITE_URL}/privacy`} target="_blank" rel="noreferrer" className={link}>{t.footerPrivacy}</a>
          <a href={`${SITE_URL}/terms`} target="_blank" rel="noreferrer" className={link}>{t.footerTerms}</a>
        </nav>
        <p>
          © {new Date().getFullYear()} {COMPANY} · P.IVA {VAT_NUMBER} · {t.footerRights}
        </p>
      </div>
    </footer>
  );
}
