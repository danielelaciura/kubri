"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Briefcase,
  Building2,
  Layers,
  ListChecks,
  QrCode,
  ScanSearch,
  Settings,
  Shield,
  UserCog,
  Users,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useT } from "@/lib/i18n/provider";

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  organizationName: string;
  isAdmin: boolean;
}

type NavItem = {
  label: string;
  href: string;
  icon: React.ElementType;
  exact?: boolean;
};

function isActiveHref(pathname: string, href: string, exact = false): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppSidebar({ organizationName, isAdmin, ...props }: AppSidebarProps) {
  const t = useT();
  const pathname = usePathname();

  const mainItems: NavItem[] = [
    { label: t.nav.candidates, href: "/dashboard/candidates", icon: Users },
    { label: t.nav.jobs, href: "/dashboard/jobs", icon: ScanSearch },
    { label: t.nav.lists, href: "/dashboard/lists", icon: ListChecks },
    { label: t.nav.users, href: "/dashboard/users", icon: UserCog },
    { label: t.nav.settings, href: "/dashboard/settings", icon: Settings, exact: true },
    { label: t.nav.qrCodes, href: "/dashboard/qr-codes", icon: QrCode },
    { label: t.nav.stats, href: "/dashboard/stats", icon: BarChart3 },
  ];

  const adminItems: NavItem[] = [
    { label: t.nav.admin, href: "/admin", icon: Shield, exact: true },
    { label: t.nav.organizations, href: "/admin/organizations", icon: Building2 },
    { label: t.nav.pools, href: "/admin/pools", icon: Layers },
    { label: t.nav.adminJobs, href: "/admin/jobs", icon: Briefcase },
  ];

  return (
    <Sidebar variant="inset" collapsible="icon" {...props}>
      <SidebarHeader>
        <div className="flex items-center gap-2.5 px-2 py-1">
          <Image
            src="/kubri-logo.png"
            alt="Kubri"
            width={28}
            height={28}
            className="h-7 w-7 shrink-0 object-contain"
            priority
          />
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <span className="block text-sm font-semibold leading-none text-foreground">
              Kubri
            </span>
            <span className="block text-xs text-muted-foreground truncate mt-0.5">
              {organizationName}
            </span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainItems.map((item) => {
                const Icon = item.icon;
                const active = isActiveHref(pathname, item.href, item.exact);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={active}
                      tooltip={item.label}
                      className="data-[active=true]:font-semibold data-[active=true]:shadow-sm data-[active=true]:relative data-[active=true]:before:absolute data-[active=true]:before:left-0 data-[active=true]:before:top-1.5 data-[active=true]:before:bottom-1.5 data-[active=true]:before:w-[3px] data-[active=true]:before:rounded-full data-[active=true]:before:bg-kubri-700"
                      render={
                        <Link href={item.href}>
                          <Icon />
                          <span>{item.label}</span>
                        </Link>
                      }
                    />
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>{t.nav.admin}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminItems.map((item) => {
                  const Icon = item.icon;
                  const active = isActiveHref(pathname, item.href, item.exact);
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        isActive={active}
                        tooltip={item.label}
                        render={
                          <Link href={item.href}>
                            <Icon />
                            <span>{item.label}</span>
                          </Link>
                        }
                      />
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter />
    </Sidebar>
  );
}
