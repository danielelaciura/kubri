"use client";

import Link from "next/link";
import { LogOut, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { strings } from "@/lib/i18n/strings";
import { logoutAction } from "@/lib/auth-actions";

interface HeaderProps {
  userName: string;
  isAdmin: boolean;
  isOrgAdmin: boolean;
}

export function Header({ userName, isAdmin, isOrgAdmin }: HeaderProps) {
  const initials = userName
    .split(" ")
    .map((n) => n[0])
    .filter(Boolean)
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-2 border-b border-border bg-background/80 px-4 backdrop-blur-sm lg:px-6">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 h-4 self-center" />

      {isOrgAdmin && (
        <Link href="/dashboard/jobs/new">
          <Button
            size="sm"
            variant="outline"
            className="text-kubri-800 border-kubri-200 hover:bg-kubri-50"
          >
            <Plus className="mr-1 h-4 w-4" />
            Aggiungi offerta
          </Button>
        </Link>
      )}

      <div className="ml-auto flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-kubri-100 text-kubri-800">
          <span className="text-xs font-semibold">{initials}</span>
        </div>
        <div className="hidden sm:flex flex-col items-start leading-tight">
          <span className="text-sm font-medium text-foreground">{userName}</span>
          {isAdmin && (
            <Badge
              variant="secondary"
              className="mt-0.5 h-4 px-1.5 text-[10px] bg-zinc-800 text-zinc-100"
            >
              Admin Kubri
            </Badge>
          )}
        </div>
        <form action={logoutAction}>
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
          >
            <LogOut className="mr-1.5 h-4 w-4" />
            <span className="hidden sm:inline">{strings.common.logout}</span>
          </Button>
        </form>
      </div>
    </header>
  );
}
