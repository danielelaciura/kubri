"use client";

import { useState, useTransition } from "react";
import { ListPlus, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  addCandidateToList,
  removeCandidateFromList,
  createList,
} from "@/app/(dashboard)/dashboard/lists/actions";

interface ListOption {
  id: string;
  name: string;
}

interface AddToListMenuProps {
  candidateId: string;
  lists: ListOption[];
  /** id delle liste a cui il candidato già appartiene */
  memberOf: string[];
  /** variante visiva: icona (tabelle) o bottone con testo (scheda) */
  variant?: "icon" | "button";
}

export function AddToListMenu({
  candidateId,
  lists,
  memberOf,
  variant = "icon",
}: AddToListMenuProps) {
  const [members, setMembers] = useState<Set<string>>(new Set(memberOf));
  const [options, setOptions] = useState<ListOption[]>(lists);
  const [newName, setNewName] = useState("");
  const [isPending, startTransition] = useTransition();
  const [createError, setCreateError] = useState<string | null>(null);

  const toggle = (listId: string, checked: boolean) => {
    setMembers((prev) => {
      const next = new Set(prev);
      if (checked) next.add(listId);
      else next.delete(listId);
      return next;
    });
    startTransition(async () => {
      try {
        if (checked) await addCandidateToList(listId, candidateId);
        else await removeCandidateFromList(listId, candidateId);
      } catch {
        // Rollback optimistic update on error
        setMembers((prev) => {
          const next = new Set(prev);
          if (checked) next.delete(listId);
          else next.add(listId);
          return next;
        });
      }
    });
  };

  const handleCreate = () => {
    const name = newName.trim();
    if (!name) return;
    setCreateError(null);
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("name", name);
        const created = await createList(fd);
        setOptions((prev) =>
          [...prev, created].sort((a, b) => a.name.localeCompare(b.name)),
        );
        setNewName("");
        await addCandidateToList(created.id, candidateId);
        setMembers((prev) => new Set(prev).add(created.id));
      } catch (e) {
        setCreateError(e instanceof Error ? e.message : "Errore nella creazione");
      }
    });
  };

  return (
    <Popover>
      <PopoverTrigger
        render={
          variant === "button" ? (
            <Button variant="outline" size="sm" className="gap-2">
              <ListPlus className="h-4 w-4" />
              Aggiungi a lista
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Aggiungi a lista"
              onClick={(e) => e.stopPropagation()}
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ListPlus className="h-4 w-4" />
              )}
            </Button>
          )
        }
      />
      <PopoverContent
        align="end"
        className="w-60"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="px-1 pb-1 text-xs font-medium text-muted-foreground">
          Liste
        </p>
        {options.length === 0 ? (
          <p className="px-1 py-1 text-sm text-muted-foreground">
            Nessuna lista. Creane una qui sotto.
          </p>
        ) : (
          <div className="max-h-56 overflow-y-auto">
            {options.map((l) => {
              const isMember = members.has(l.id);
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => toggle(l.id, !isMember)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                >
                  <span className="flex-1 truncate text-left">{l.name}</span>
                  {isMember && (
                    <span className="ml-auto shrink-0 text-xs font-medium text-muted-foreground">
                      Aggiunto
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
        <div className="my-1 h-px bg-border" />
        <div className="flex items-center gap-1">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleCreate();
              }
            }}
            placeholder="Nuova lista..."
            className="h-8 flex-1"
          />
          <Button
            size="icon"
            className="h-8 w-8 shrink-0"
            disabled={isPending || !newName.trim()}
            onClick={handleCreate}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        {createError && (
          <p className="px-1 pt-1 text-xs text-destructive">{createError}</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
