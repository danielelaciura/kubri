"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Bell,
  Building2,
  Database,
  Inbox,
  LayoutDashboard,
  Network,
  RotateCcw,
  Users,
  Briefcase,
  ArrowLeftRight,
} from "lucide-react";
import { AGENCY, ASSOCIATIONS, DEMO_ASSOCIATION_ID } from "@/lib/data";
import { relativeDay } from "@/lib/format";
import { useDemo } from "@/lib/store";
import { asset } from "@/lib/asset";

export type Role = "agenzia" | "associazione";

const NAV: Record<Role, { href: string; label: string; icon: typeof Bell; exact?: boolean }[]> = {
  agenzia: [
    { href: "/agenzia", label: "Panoramica", icon: LayoutDashboard, exact: true },
    { href: "/agenzia/offerte", label: "Offerte e appelli", icon: Briefcase },
    { href: "/agenzia/rete", label: "Rete associazioni", icon: Network },
    { href: "/agenzia/candidati", label: "Database candidati", icon: Database },
  ],
  associazione: [
    { href: "/associazione", label: "Panoramica", icon: LayoutDashboard, exact: true },
    { href: "/associazione/appelli", label: "Appelli ricevuti", icon: Inbox },
    { href: "/associazione/candidati", label: "I miei candidati", icon: Users },
  ],
};

function isActive(pathname: string, href: string, exact?: boolean) {
  const p = pathname.replace(/\/$/, "") || "/";
  if (exact) return p === href;
  if (href === "/agenzia/offerte") return p.startsWith("/agenzia/offert");
  if (href === "/agenzia/candidati") return p.startsWith("/agenzia/candidat");
  if (href === "/associazione/appelli") return p.startsWith("/associazione/appell") || p.startsWith("/associazione/notifica");
  return p.startsWith(href);
}

export function AppShell({ role, children }: { role: Role; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { reset } = useDemo();
  const assoc = ASSOCIATIONS.find((a) => a.id === DEMO_ASSOCIATION_ID);
  const org = role === "agenzia" ? AGENCY.name : (assoc?.name ?? "");
  const orgKind = role === "agenzia" ? "Agenzia per il Lavoro" : (assoc?.kind ?? "");
  const user = role === "agenzia" ? `${AGENCY.userName} · ${AGENCY.userRole}` : `${assoc?.contactName} · Operatore`;

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-sidebar md:flex">
        <Link href="/" className="flex items-center gap-2 px-5 pt-5 pb-4" title="Torna alla scelta del ruolo">
          <Image src={asset("/kubri-logo.png")} alt="" width={108} height={112} className="h-6 w-auto" priority />
          <span className="text-[16px] font-semibold text-primary-strong">kubri</span>
        </Link>
        <div className="mx-3 mb-3 flex items-center gap-3 rounded-lg border border-line bg-panel px-3 py-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary-strong">
            <Building2 className="size-4" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold">{org}</span>
            <span className="block truncate text-[12px] text-ink-3">{orgKind}</span>
          </span>
        </div>
        <nav className="flex flex-col gap-0.5 px-3" aria-label="Navigazione principale">
          {NAV[role].map((item) => {
            const on = isActive(pathname, item.href, item.exact);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={on ? "page" : undefined}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors ${
                  on ? "bg-panel text-primary-strong shadow-[0_1px_2px_oklch(0.3_0.05_291/0.08)]" : "text-ink-2 hover:bg-panel/70 hover:text-ink"
                }`}
              >
                <Icon className={`size-4 ${on ? "text-primary" : "text-ink-3"}`} aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto border-t border-line px-5 py-4 text-[12px] text-ink-3">
          <div className="truncate text-ink-2">{user}</div>
          <button
            type="button"
            onClick={() => {
              reset();
              router.push("/");
            }}
            className="mt-2 inline-flex items-center gap-1.5 hover:text-primary-strong"
          >
            <RotateCcw className="size-3.5" aria-hidden="true" />
            Ricomincia la demo
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b border-line bg-panel/90 px-6 backdrop-blur-sm">
          <div className="flex items-center gap-2 text-[13px] text-ink-2">
            <span className="rounded-md bg-warn-soft px-2 py-0.5 text-[12px] font-medium text-warn">Dati dimostrativi</span>
            <span className="hidden sm:inline">
              Stai vedendo Kubri come <strong className="font-semibold text-ink">{role === "agenzia" ? "agenzia" : "associazione"}</strong>
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Notifications role={role} />
            <Link
              href={role === "agenzia" ? "/associazione" : "/agenzia"}
              className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-[13px] font-medium text-ink-2 hover:bg-primary-soft hover:text-primary-strong"
            >
              <ArrowLeftRight className="size-4" aria-hidden="true" />
              Passa ad {role === "agenzia" ? "associazione" : "agenzia"}
            </Link>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1180px] flex-1 px-6 pt-8 pb-32">{children}</main>
      </div>
    </div>
  );
}

function Notifications({ role }: { role: Role }) {
  const { notifications, markNotificationsRead } = useDemo();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const mine = notifications.filter(
    (n) => n.audience === role && (role === "agenzia" || n.associationId === DEMO_ASSOCIATION_ID),
  );
  const unread = mine.filter((n) => !n.read).length;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-expanded={open}
        aria-label={`Notifiche${unread ? `, ${unread} da leggere` : ""}`}
        onClick={() => {
          setOpen((v) => !v);
          if (!open && unread) markNotificationsRead(role);
        }}
        className="relative inline-flex size-9 items-center justify-center rounded-lg text-ink-2 hover:bg-primary-soft hover:text-primary-strong"
      >
        <Bell className="size-[18px]" aria-hidden="true" />
        {unread ? (
          <span className="tabular absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-white">
            {unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="animate-rise absolute right-0 mt-2 w-[360px] overflow-hidden rounded-xl border border-line bg-panel shadow-[0_12px_32px_-8px_oklch(0.25_0.05_291/0.18)]">
          <div className="border-b border-line px-4 py-3 text-[13px] font-semibold">Notifiche</div>
          {mine.length === 0 ? (
            <p className="px-4 py-6 text-center text-ink-2">Nessuna notifica.</p>
          ) : (
            <ul className="max-h-[360px] overflow-auto">
              {mine.map((n) => (
                <li key={n.id} className="border-b border-line last:border-0">
                  <Link href={n.href} onClick={() => setOpen(false)} className="block px-4 py-3 hover:bg-primary-soft/50">
                    <span className="block text-[13px] text-ink">{n.text}</span>
                    <span className="mt-0.5 block text-[12px] text-ink-3">{relativeDay(n.at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
