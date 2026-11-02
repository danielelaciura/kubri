import { Download, FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Dictionary, Locale } from "@/lib/i18n";

export interface CandidateDocumentRow {
  id: string;
  fileName: string;
  createdAt: Date;
  uploadedByName: string | null;
  fromLanding?: boolean;
}

export function CandidateDocuments({
  candidateId, documents, t, locale,
}: {
  candidateId: string;
  documents: CandidateDocumentRow[];
  t: Dictionary;
  locale: Locale;
}) {
  if (documents.length === 0) return null;
  const tc = t.candidateCreate;
  const dateOf = (date: Date) => date.toLocaleDateString(locale === "it" ? "it-IT" : "en-GB");
  return (
    <Card className="shadow-sm border-border/60">
      <CardHeader>
        <CardTitle>{tc.documents}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {documents.map((d) => (
          <div key={d.id} className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0">
                <p className="truncate text-sm">{d.fileName}</p>
                <p className="text-xs text-muted-foreground">
                  {d.fromLanding
                    ? `${t.candidates.documentFromLanding} · ${dateOf(d.createdAt)}`
                    : tc.documentUploaded
                        .replace("{name}", d.uploadedByName ?? t.candidates.deletedUser)
                        .replace("{date}", dateOf(d.createdAt))}
                </p>
              </div>
            </div>
            <a
              href={`/api/candidates/${candidateId}/documents/${d.id}`}
              className="inline-flex items-center gap-1 text-sm text-kubri-600 underline hover:text-kubri-800"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              {tc.download}
            </a>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
