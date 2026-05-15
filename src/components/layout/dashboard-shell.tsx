import { AppSidebar } from "@/components/layout/app-sidebar";
import { Header } from "@/components/layout/header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

interface DashboardShellProps {
  userName: string;
  userEmail: string;
  organizationName: string;
  isAdmin: boolean;
  isOrgAdmin: boolean;
  children: React.ReactNode;
}

export function DashboardShell({
  userName,
  userEmail,
  organizationName,
  isAdmin,
  isOrgAdmin,
  children,
}: DashboardShellProps) {
  return (
    <SidebarProvider>
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
  );
}
