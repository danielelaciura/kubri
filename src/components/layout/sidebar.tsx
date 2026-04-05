"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Users, Settings, BarChart3, Shield, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { strings } from "@/lib/i18n/strings";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

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
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border bg-card transition-transform duration-200 lg:translate-x-0 lg:static lg:z-auto",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Header */}
        <div className="flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-lg font-bold text-kubri-600 shrink-0">
              Kubri
            </span>
            <Separator orientation="vertical" className="h-5" />
            <span className="text-sm text-muted-foreground truncate">
              {organizationName}
            </span>
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

        <Separator />

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
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-kubri-50 text-kubri-700"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                <item.icon
                  className={cn(
                    "h-4 w-4 shrink-0",
                    isActive ? "text-kubri-600" : ""
                  )}
                />
                {item.label}
              </Link>
            );
          })}

          {isAdmin && (
            <>
              <Separator className="my-3" />
              {(() => {
                const isActive =
                  pathname === adminItem.href ||
                  pathname.startsWith(adminItem.href + "/");
                return (
                  <Link
                    href={adminItem.href}
                    onClick={onClose}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-kubri-50 text-kubri-700"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
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
