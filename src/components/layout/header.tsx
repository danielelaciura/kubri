"use client";

import Link from "next/link";
import { LogOut, Plus, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { strings } from "@/lib/i18n/strings";
import { logoutAction } from "@/lib/auth-actions";

interface HeaderProps {
  userName: string;
  userEmail: string;
  isAdmin: boolean;
  isOrgAdmin: boolean;
}

export function Header({ userName, userEmail, isAdmin, isOrgAdmin }: HeaderProps) {
  const initials = userName
    .split(" ")
    .map((n) => n[0])
    .filter(Boolean)
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-2 border-b border-border px-4 backdrop-blur-sm lg:px-6">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 h-4 self-center!" />

      {isOrgAdmin && (
        <Link href="/dashboard/jobs/new">
          <Button
            size="sm"
            variant="outline"
            className="text-kubri-800 border-kubri-200 hover:bg-kubri-50"
          >
            <Plus className="mr-1 h-4 w-4" />
            Crea analisi
          </Button>
        </Link>
      )}

      <div className="ml-auto">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label="Apri menu utente"
                className="flex items-center gap-2 rounded-full p-0.5 outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 hover:bg-muted"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-kubri-100 text-kubri-800 text-sm font-semibold">
                  {initials}
                </span>
              </button>
            }
          />
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex flex-col gap-0.5 py-2">
                <span className="text-sm font-medium leading-none text-foreground">{userName}</span>
                {userEmail && (
                  <span className="text-xs font-normal leading-tight text-muted-foreground truncate">
                    {userEmail}
                  </span>
                )}
                {isAdmin && (
                  <Badge
                    variant="secondary"
                    className="mt-1 h-4 w-fit px-1.5 text-[10px] bg-zinc-800 text-zinc-100"
                  >
                    Admin Kubri
                  </Badge>
                )}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              render={
                <Link href="/dashboard/profile">
                  <UserRound className="mr-2 h-4 w-4" />
                  <span>{strings.common.profile}</span>
                </Link>
              }
            />
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              render={
                <form action={logoutAction} className="contents">
                  <button type="submit" className="flex w-full items-center">
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>{strings.common.logout}</span>
                  </button>
                </form>
              }
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
