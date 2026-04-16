"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Users, Settings, BarChart3, Shield, X, Briefcase } from "lucide-react";
import { cn } from "@/lib/utils";
import { strings } from "@/lib/i18n/strings";
import { Button } from "@/components/ui/button";

interface SidebarProps {
  organizationName: string;
  isAdmin: boolean;
  isOpen: boolean;
  onClose: () => void;
}

const navItems = [
  {
    label: strings.nav.candidates,
    href: "/dashboard/candidates",
    icon: Users,
  },
  {
    label: strings.nav.jobs,
    href: "/dashboard/jobs",
    icon: Briefcase,
  },
  {
    label: strings.nav.settings,
    href: "/dashboard/settings",
    icon: Settings,
  },
  {
    label: strings.nav.stats,
    href: "/dashboard/stats",
    icon: BarChart3,
  },
];

const adminItem = {
  label: strings.nav.admin,
  href: "/admin",
  icon: Shield,
};

export function Sidebar({
  organizationName,
  isAdmin,
  isOpen,
  onClose,
}: SidebarProps) {
  const pathname = usePathname();

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border bg-sidebar transition-transform duration-200 lg:translate-x-0 lg:static lg:z-auto",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Header */}
        <div className="flex h-16 items-center justify-between px-5">
          <div className="flex items-center gap-2.5 min-w-0">
            <Image
              src="/kubri-logo.png"
              alt="Kubri"
              width={32}
              height={32}
              className="h-8 w-8 shrink-0 object-contain"
              priority
            />
            <div className="min-w-0">
              <span className="block text-sm font-semibold text-foreground">
                Kubri
              </span>
              <span className="block text-xs text-muted-foreground truncate">
                {organizationName}
              </span>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden shrink-0"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
            <span className="sr-only">Chiudi menu</span>
          </Button>
        </div>

        <div className="mx-4 border-t border-border" />

        {/* Navigation */}
        <nav className="flex-1 space-y-1 p-3">
          {navItems.map((item) => {
            const isActive =
              pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-kubri-50 text-kubri-800"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                <item.icon
                  className={cn(
                    "h-4 w-4 shrink-0",
                    isActive ? "text-kubri-800" : ""
                  )}
                />
                {item.label}
              </Link>
            );
          })}

          {isAdmin && (
            <>
              <div className="mx-1 my-3 border-t border-border" />
              {(() => {
                const isActive =
                  pathname === adminItem.href ||
                  pathname.startsWith(adminItem.href + "/");
                return (
                  <Link
                    href={adminItem.href}
                    onClick={onClose}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-kubri-100 text-kubri-800"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                  >
                    <adminItem.icon
                      className={cn(
                        "h-4 w-4 shrink-0",
                        isActive ? "text-kubri-600" : ""
                      )}
                    />
                    {adminItem.label}
                  </Link>
                );
              })()}
            </>
          )}
        </nav>
      </aside>
    </>
  );
}
