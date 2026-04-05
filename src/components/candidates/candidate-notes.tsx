"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { addNote } from "@/app/(dashboard)/dashboard/candidates/[id]/actions";
import { Loader2 } from "lucide-react";

interface NoteData {
  id: string;
  content: string;
  userName: string;
  createdAt: Date;
}

interface CandidateNotesProps {
  notes: NoteData[];
  makeRecordId: string;
}

function formatDateTime(date: Date): string {
  return date.toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function AddNoteForm({ makeRecordId }: { makeRecordId: string }) {
  const [error, formAction, isPending] = useActionState(
    async (_prevState: string | null, formData: FormData) => {
      try {
        await addNote(formData);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Errore nell'aggiunta della nota";
      }
    },
    null,
  );

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="makeRecordId" value={makeRecordId} />
      <textarea
        name="content"
        placeholder="Scrivi una nota..."
        required
        rows={3}
        className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
        disabled={isPending}
      />
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
      <Button type="submit" size="sm" disabled={isPending}>
        {isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
        Aggiungi nota
      </Button>
    </form>
  );
}

export function CandidateNotes({ notes, makeRecordId }: CandidateNotesProps) {
  const sortedNotes = [...notes].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Note</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <AddNoteForm makeRecordId={makeRecordId} />

        {sortedNotes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nessuna nota aggiunta
          </p>
        ) : (
          <div className="space-y-3">
            {sortedNotes.map((note) => (
              <div
                key={note.id}
                className="rounded-lg border border-border bg-muted/30 p-3"
              >
                <p className="text-sm whitespace-pre-wrap">{note.content}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {note.userName} &middot; {formatDateTime(note.createdAt)}
                </p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
