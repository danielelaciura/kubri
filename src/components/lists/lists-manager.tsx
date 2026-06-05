"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Loader2, Plus, Trash2, Download, Pencil, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  createList,
  deleteList,
  renameList,
} from "@/app/(dashboard)/dashboard/lists/actions";

interface ListRow {
  id: string;
  name: string;
  memberCount: number;
}

export function ListsManager({ lists }: { lists: ListRow[] }) {
  const [name, setName] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

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
      } catch (e) {
        setError(e instanceof Error ? e.message : "Errore nella creazione");
      }
    });
  };

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

  return (
    <div className="space-y-6">
      <Card className="flex items-center gap-2 p-4">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          placeholder="Nome nuova lista..."
          className="max-w-sm"
        />
        <Button onClick={handleCreate} disabled={isPending || !name.trim()} className="gap-1">
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Crea lista
        </Button>
        {error && <span className="text-sm text-destructive">{error}</span>}
      </Card>

      {lists.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nessuna lista creata.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {lists.map((l) => {
            const isEditing = editingId === l.id;
            return (
              <Card key={l.id} className="flex items-center justify-between p-4">
                {isEditing ? (
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRenameConfirm(l.id);
                      if (e.key === "Escape") handleRenameCancel();
                    }}
                    className="mr-2 min-w-0 flex-1"
                    autoFocus
                  />
                ) : (
                  <Link href={`/dashboard/lists/${l.id}`} className="min-w-0">
                    <p className="truncate font-medium hover:underline">{l.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {l.memberCount} candidati
                    </p>
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
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
