"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Briefcase,
  Building2,
  Layers,
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
import { strings } from "@/lib/i18n/strings";

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  organizationName: string;
  isAdmin: boolean;
}

const mainItems = [
  { label: strings.nav.candidates, href: "/dashboard/candidates", icon: Users },
  { label: strings.nav.jobs, href: "/dashboard/jobs", icon: ScanSearch },
  { label: strings.nav.users, href: "/dashboard/users", icon: UserCog },
  { label: strings.nav.settings, href: "/dashboard/settings", icon: Settings, exact: true },
  { label: strings.nav.qrCodes, href: "/dashboard/qr-codes", icon: QrCode },
  { label: strings.nav.stats, href: "/dashboard/stats", icon: BarChart3 },
];

const adminItems = [
  { label: strings.nav.admin, href: "/admin", icon: Shield, exact: true },
  { label: strings.nav.organizations, href: "/admin/organizations", icon: Building2 },
  { label: strings.nav.pools, href: "/admin/pools", icon: Layers },
  { label: strings.nav.adminJobs, href: "/admin/jobs", icon: Briefcase },
];

function isActiveHref(pathname: string, href: string, exact = false): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppSidebar({ organizationName, isAdmin, ...props }: AppSidebarProps) {
  const pathname = usePathname();

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
            <SidebarGroupLabel>{strings.nav.admin}</SidebarGroupLabel>
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
