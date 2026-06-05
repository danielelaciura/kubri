"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Loader2, Trash2, Download, Pencil, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  deleteList,
  renameList,
} from "@/app/(dashboard)/dashboard/lists/actions";

interface ListRow {
  id: string;
  name: string;
  memberCount: number;
}

export function ListsManager({ lists }: { lists: ListRow[] }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const handleRenameStart = (l: ListRow) => {
    setEditingId(l.id);
    setEditName(l.name);
    setError(null);
  };

  const handleRenameCancel = () => {
    setEditingId(null);
    setEditName("");
  };

  const handleRenameConfirm = (id: string) => {
    const trimmed = editName.trim();
    if (!trimmed) return;
    setError(null);
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("listId", id);
        fd.set("name", trimmed);
        await renameList(fd);
        setEditingId(null);
        setEditName("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Errore nella rinomina");
      }
    });
  };

  const handleDelete = (id: string) => {
    startTransition(async () => {
      try {
        await deleteList(id);
      } catch {
        // revalidate gestisce lo stato
      }
    });
  };

  if (lists.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">Nessuna lista creata.</p>
    );
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="divide-y divide-border/60 rounded-lg border border-border/60 bg-card shadow-sm">
        {lists.map((l) => {
          const isEditing = editingId === l.id;
          return (
            <div
              key={l.id}
              className="flex items-center justify-between gap-2 px-4 py-3"
            >
              {isEditing ? (
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRenameConfirm(l.id);
                    if (e.key === "Escape") handleRenameCancel();
                  }}
                  className="min-w-0 flex-1"
                  autoFocus
                />
              ) : (
                <Link
                  href={`/dashboard/lists/${l.id}`}
                  className="flex min-w-0 flex-1 items-baseline gap-2"
                >
                  <span className="truncate font-medium hover:underline">
                    {l.name}
                  </span>
                  <span className="shrink-0 text-sm text-muted-foreground">
                    {l.memberCount} candidati
                  </span>
                </Link>
              )}
              <div className="flex shrink-0 items-center gap-1">
                {isEditing ? (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Conferma rinomina"
                      disabled={isPending || !editName.trim()}
                      onClick={() => handleRenameConfirm(l.id)}
                    >
                      {isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Check className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Annulla rinomina"
                      disabled={isPending}
                      onClick={handleRenameCancel}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Rinomina lista"
                      disabled={isPending}
                      onClick={() => handleRenameStart(l)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <a
                      href={`/api/candidates/lists/${l.id}/export/csv`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button variant="ghost" size="icon" aria-label="Esporta CSV">
                        <Download className="h-4 w-4" />
                      </Button>
                    </a>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Elimina lista"
                      disabled={isPending}
                      onClick={() => handleDelete(l.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
