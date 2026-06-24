"use client";

import { useState, useTransition } from "react";
import { Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            Crea lista
          </Button>
        }
      />
      <PopoverContent align="end">
        <p className="px-1 pb-2 text-xs font-medium text-muted-foreground">
          Nuova lista
        </p>
        <div className="flex items-center gap-1">
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
          <p className="px-1 pt-2 text-xs text-destructive">{error}</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
