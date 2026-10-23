"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { usePendingProgress } from "@/components/layout/route-progress";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import {
  registerCandidateUploadAction,
  requestCandidateUploadAction,
} from "@/app/(dashboard)/dashboard/candidates/new/actions";
import type { PoolOption } from "./candidate-form";

const ACCEPT = ".pdf,.docx,.jpg,.jpeg,.png,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png";
const MAX_BYTES = 10 * 1024 * 1024;
const BUCKET = "candidate-documents";

export function CvUpload({ pools }: { pools: PoolOption[] }) {
  const t = useT();
  const tc = t.candidateCreate;
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [poolId, setPoolId] = useState(pools[0]?.id ?? "");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  usePendingProgress(busy);

  async function upload(file: File) {
    setError(null);
    if (file.size > MAX_BYTES) {
      setError(tc.errors.FILE_TOO_LARGE);
      return;
    }
    setBusy(true);
    try {
      const ticket = await requestCandidateUploadAction({ poolId, fileName: file.name, fileSize: file.size });
      if (!ticket.ok) {
        setError(tc.errors[ticket.error]);
        return;
      }
      // Straight to Storage: Vercel caps request bodies at 4.5 MB.
      const { error: upErr } = await createSupabaseBrowserClient()
        .storage.from(BUCKET)
        .uploadToSignedUrl(ticket.data.storagePath, ticket.data.token, file, {
          contentType: file.type || undefined,
        });
      if (upErr) {
        setError(tc.errors.STORAGE_ERROR);
        return;
      }
      const reg = await registerCandidateUploadAction({
        importId: ticket.data.importId,
        poolId,
        fileName: file.name,
      });
      if (!reg.ok) {
        setError(tc.errors[reg.error]);
        return;
      }
      router.push(`/dashboard/candidates/imports/${reg.data.importId}`);
    } catch {
      setError(tc.errors.INTERNAL_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {pools.length > 1 && (
        <div className="space-y-1.5">
          <Label htmlFor="cv-pool">{tc.pool}</Label>
          <select
            id="cv-pool" value={poolId} onChange={(e) => setPoolId(e.target.value)}
            className="h-9 w-full max-w-sm rounded-md border border-input bg-white px-2 text-sm"
          >
            {pools.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      )}

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file && !busy) void upload(file);
        }}
        className={cn(
          "flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-12 text-center transition-colors",
          dragging ? "border-kubri-500 bg-kubri-50" : "border-border",
        )}
      >
        {busy ? <Spinner aria-label={tc.uploading} /> : <FileUp className="h-10 w-10 text-muted-foreground/60" aria-hidden="true" />}
        <p className="font-medium">{busy ? tc.uploading : tc.dropzoneTitle}</p>
        <p className="text-sm text-muted-foreground">{tc.dropzoneHint}</p>
        <input
          ref={inputRef} type="file" accept={ACCEPT} className="sr-only"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }}
        />
        <Button type="button" variant="outline" disabled={busy} onClick={() => inputRef.current?.click()}>
          {tc.chooseFile}
        </Button>
      </div>

      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    </div>
  );
}
