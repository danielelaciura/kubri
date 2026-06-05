"use client";

import { useState, useTransition } from "react";
import { Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { createList } from "@/app/(dashboard)/dashboard/lists/actions";

export function CreateListMenu() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleCreate = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("name", trimmed);
        await createList(fd);
        setName("");
        setOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Errore nella creazione");
      }
    });
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <Button size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            Crea lista
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Nuova lista</DropdownMenuLabel>
        </DropdownMenuGroup>
        <div className="flex items-center gap-1 p-1">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleCreate();
              }
            }}
            placeholder="Nome lista..."
            className="h-8 flex-1"
            autoFocus
          />
          <Button
            size="icon"
            className="h-8 w-8 shrink-0"
            disabled={isPending || !name.trim()}
            onClick={handleCreate}
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
          </Button>
        </div>
        {error && (
          <p className="px-2 pb-1 text-xs text-destructive">{error}</p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
