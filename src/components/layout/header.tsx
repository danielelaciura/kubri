"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";
import { LogOut, Menu, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { strings } from "@/lib/i18n/strings";

interface HeaderProps {
  userName: string;
  isOrgAdmin: boolean;
  onMenuToggle: () => void;
}

export function Header({ userName, isOrgAdmin, onMenuToggle }: HeaderProps) {
  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-card px-4 lg:px-6 shadow-sm">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={onMenuToggle}
      >
        <Menu className="h-5 w-5" />
        <span className="sr-only">Apri menu</span>
      </Button>

      <div className="lg:hidden" />
      {isOrgAdmin && (
        <Link href="/dashboard/jobs/new" className="hidden lg:block">
          <Button
            size="lg"
            className="text-kubri-800 bg-white border border-kubri-800 hover:bg-kubri-50"
          >
            <Plus className="mr-1 h-4 w-4" />
            Aggiungi Job description
          </Button>
        </Link>
      )}
      <div className="hidden lg:block" />

      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-kubri-100 text-kubri-800">
          <span className="text-xs font-semibold">
            {userName.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
          </span>
        </div>
        <span className="text-sm font-medium text-foreground">{userName}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="text-muted-foreground hover:text-foreground"
        >
          <LogOut className="mr-1.5 h-4 w-4" />
          {strings.common.logout}
        </Button>
      </div>
    </header>
  );
}
