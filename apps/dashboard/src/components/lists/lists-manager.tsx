"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Loader2, Trash2, Download, Pencil, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useT } from "@/lib/i18n/provider";
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
  const t = useT();
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
        setError(e instanceof Error ? e.message : t.lists.renameError);
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
      <p className="text-sm text-muted-foreground">{t.lists.empty}</p>
    );
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="overflow-hidden rounded-lg border border-border/60 bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.common.name}</TableHead>
              <TableHead>{t.lists.candidatesColumn}</TableHead>
              <TableHead className="text-right">
                {t.common.actions}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lists.map((l) => {
              const isEditing = editingId === l.id;
              return (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">
                    {isEditing ? (
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleRenameConfirm(l.id);
                          if (e.key === "Escape") handleRenameCancel();
                        }}
                        className="max-w-xs"
                        autoFocus
                      />
                    ) : (
                      <Link
                        href={`/dashboard/lists/${l.id}`}
                        className="hover:underline"
                      >
                        {l.name}
                      </Link>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {l.memberCount}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {isEditing ? (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t.lists.confirmRename}
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
                            aria-label={t.lists.cancelRename}
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
                            aria-label={t.lists.renameList}
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
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={t.candidates.exportCsv}
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                          </a>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t.lists.deleteList}
                            disabled={isPending}
                            onClick={() => handleDelete(l.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
