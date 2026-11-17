import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import type { Candidate } from "@/lib/types";
import { initials } from "@/lib/format";

type Variant = "primary" | "secondary" | "ghost";

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-primary text-white hover:bg-primary-strong active:bg-primary-strong disabled:bg-line-strong disabled:text-ink-3",
  secondary:
    "border border-line-strong bg-panel text-ink hover:border-primary-line hover:bg-primary-soft disabled:text-ink-3 disabled:hover:bg-panel",
  ghost: "text-ink-2 hover:bg-primary-soft hover:text-primary-strong",
};

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 h-9 text-[13px] font-medium transition-colors duration-150 disabled:cursor-not-allowed whitespace-nowrap";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: Variant }) {
  return <button type="button" className={`${BASE} ${VARIANT[variant]} ${className}`} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={`${BASE} ${VARIANT[variant]} ${className}`} {...props} />;
}

type Tone = "neutral" | "primary" | "good" | "warn" | "bad";
const TONE: Record<Tone, string> = {
  neutral: "bg-sidebar text-ink-2 ring-line",
  primary: "bg-primary-soft text-primary-strong ring-primary-line",
  good: "bg-good-soft text-good ring-good/25",
  warn: "bg-warn-soft text-warn ring-warn/25",
  bad: "bg-bad-soft text-bad ring-bad/25",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[12px] font-medium ring-1 ring-inset ${TONE[tone]}`}>
      {children}
    </span>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {back ? (
          <Link href={back.href} className="mb-2 inline-block text-[13px] text-ink-3 hover:text-primary-strong">
            ← {back.label}
          </Link>
        ) : null}
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-balance">{title}</h1>
        {description ? <p className="mt-1 max-w-[70ch] text-ink-2">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Section({
  title,
  aside,
  children,
  className = "",
}: {
  title?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-line bg-panel ${className}`}>
      {title ? (
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h2 className="text-[14px] font-semibold">{title}</h2>
          {aside}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Avatar({ candidate, hidden = false }: { candidate: Candidate; hidden?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[12px] font-semibold text-primary-strong"
    >
      {hidden ? "··" : initials(candidate)}
    </span>
  );
}

/** Punteggio di compatibilità: numero + barra, mai un verdetto senza spiegazione accanto. */
export function Score({ value }: { value: number }) {
  const tone = value >= 80 ? "bg-good" : value >= 65 ? "bg-primary" : "bg-warn";
  return (
    <span className="inline-flex items-center gap-2" title={`Compatibilità ${value} su 100`}>
      <span className="tabular w-7 text-right text-[13px] font-semibold">{value}</span>
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-line">
        <span className={`block h-full rounded-full ${tone}`} style={{ width: `${value}%` }} />
      </span>
    </span>
  );
}

export function Stat({ label, value, hint, href }: { label: string; value: ReactNode; hint?: string; href?: string }) {
  const body = (
    <>
      <div className="text-[13px] text-ink-2">{label}</div>
      <div className="tabular mt-1 text-[26px] font-semibold leading-none tracking-[-0.02em]">{value}</div>
      {hint ? <div className="mt-2 text-[12px] text-ink-3">{hint}</div> : null}
    </>
  );
  const cls = "block px-5 py-4";
  return href ? (
    <Link href={href} className={`${cls} transition-colors hover:bg-primary-soft/60`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-ink-2">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[12px] text-ink-3">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border border-line-strong bg-panel px-3 py-2 text-[14px] text-ink placeholder:text-ink-3 transition-colors hover:border-primary-line focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary/15";

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-5 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children ? <div className="mx-auto mt-1 max-w-[52ch] text-ink-2">{children}</div> : null}
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: T; label: string; count?: number }[];
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div role="tablist" className="flex gap-1 border-b border-line px-3">
      {tabs.map((t) => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={on}
            type="button"
            onClick={() => onChange(t.id)}
            className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-3 text-[13px] font-medium transition-colors ${
              on ? "border-primary text-primary-strong" : "border-transparent text-ink-2 hover:text-ink"
            }`}
          >
            {t.label}
            {t.count !== undefined ? (
              <span className={`tabular rounded-md px-1.5 text-[12px] ${on ? "bg-primary-soft" : "bg-sidebar"}`}>{t.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
