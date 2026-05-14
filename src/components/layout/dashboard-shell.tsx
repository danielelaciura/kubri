import { AppSidebar } from "@/components/layout/app-sidebar";
import { Header } from "@/components/layout/header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

interface DashboardShellProps {
  userName: string;
  organizationName: string;
  isAdmin: boolean;
  isOrgAdmin: boolean;
  children: React.ReactNode;
}

export function DashboardShell({
  userName,
  organizationName,
  isAdmin,
  isOrgAdmin,
  children,
}: DashboardShellProps) {
  return (
    <SidebarProvider>
      <AppSidebar organizationName={organizationName} isAdmin={isAdmin} />
      <SidebarInset>
        <Header userName={userName} isAdmin={isAdmin} isOrgAdmin={isOrgAdmin} />
        <main className="flex-1 overflow-y-auto bg-background">
          <div className="mx-auto w-full max-w-7xl p-4 lg:p-6">{children}</div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
