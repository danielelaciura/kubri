"use client";

import { signOut } from "next-auth/react";
import { LogOut, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { strings } from "@/lib/i18n/strings";

interface HeaderProps {
  userName: string;
  onMenuToggle: () => void;
}

export function Header({ userName, onMenuToggle }: HeaderProps) {
  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-card px-4 lg:px-6">
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

      {/* Spacer for desktop — pushes user info to the right */}
      <div className="hidden lg:block" />

      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">{userName}</span>
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
