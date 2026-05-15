"use client";

import { useState, useActionState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  addTag,
  removeTag,
} from "@/app/(dashboard)/dashboard/candidates/[id]/actions";
import { X, Loader2, Plus } from "lucide-react";

interface TagData {
  id: string;
  tag: string;
}

interface CandidateTagsProps {
  tags: TagData[];
  candidateId: string;
}

function AddTagForm({
  candidateId,
  existingTags,
}: {
  candidateId: string;
  existingTags: string[];
}) {
  const [tagValue, setTagValue] = useState("");

  const [error, formAction, isPending] = useActionState(
    async (_prevState: string | null, formData: FormData) => {
      try {
        await addTag(formData);
        setTagValue("");
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Errore nell'aggiunta del tag";
      }
    },
    null,
  );

  const trimmedTag = tagValue.trim();
  const isDuplicate = existingTags.includes(trimmedTag.toLowerCase());

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="candidateId" value={candidateId} />
      <Input
        name="tag"
        placeholder="Nuovo tag..."
        value={tagValue}
        onChange={(e) => setTagValue(e.target.value)}
        disabled={isPending}
        className="flex-1"
      />
      <Button
        type="submit"
        size="sm"
        disabled={isPending || !trimmedTag || isDuplicate}
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Plus className="h-4 w-4" />
        )}
      </Button>
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
    </form>
  );
}

function RemoveTagButton({ tagId }: { tagId: string }) {
  const [isPending, setIsPending] = useState(false);

  const handleRemove = async () => {
    setIsPending(true);
    try {
      await removeTag(tagId);
    } catch {
      // Error is handled by revalidation
    } finally {
      setIsPending(false);
    }
  };

  return (
    <button
      onClick={handleRemove}
      disabled={isPending}
      className="ml-1 inline-flex items-center rounded-full p-0.5 hover:bg-muted-foreground/20 disabled:opacity-50"
      aria-label="Rimuovi tag"
    >
      {isPending ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <X className="h-3 w-3" />
      )}
    </button>
  );
}

export function CandidateTags({ tags, candidateId }: CandidateTagsProps) {
  const existingTagNames = tags.map((t) => t.tag.toLowerCase());

  return (
    <Card className="shadow-sm border-border/60">
      <CardHeader>
        <CardTitle>Tag</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <AddTagForm
          candidateId={candidateId}
          existingTags={existingTagNames}
        />

        {tags.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nessun tag aggiunto
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {tags.map((tagItem) => (
              <Badge
                key={tagItem.id}
                variant="secondary"
                className="flex items-center gap-0.5 pr-1"
              >
                {tagItem.tag}
                <RemoveTagButton tagId={tagItem.id} />
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
