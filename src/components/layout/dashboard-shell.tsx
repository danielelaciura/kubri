import { AppSidebar } from "@/components/layout/app-sidebar";
import { Header } from "@/components/layout/header";
import { RouteProgress } from "@/components/layout/route-progress";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { I18nProvider } from "@/lib/i18n/provider";
import type { Locale } from "@/lib/i18n/types";

interface DashboardShellProps {
  userName: string;
  userEmail: string;
  organizationName: string;
  isAdmin: boolean;
  isOrgAdmin: boolean;
  locale: Locale;
  children: React.ReactNode;
}

export function DashboardShell({
  userName,
  userEmail,
  organizationName,
  isAdmin,
  isOrgAdmin,
  locale,
  children,
}: DashboardShellProps) {
  return (
    <I18nProvider locale={locale}>
    <SidebarProvider>
      <RouteProgress />
      <AppSidebar organizationName={organizationName} isAdmin={isAdmin} />
      <SidebarInset className="md:m-2 md:ml-0 md:rounded-xl md:border md:border-border md:shadow-sm overflow-hidden">
        <Header
          userName={userName}
          userEmail={userEmail}
          isAdmin={isAdmin}
          isOrgAdmin={isOrgAdmin}
        />
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-7xl p-4 lg:p-6">{children}</div>
        </div>
      </SidebarInset>
    </SidebarProvider>
    </I18nProvider>
  );
}
