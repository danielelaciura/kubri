"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { TranscriptEntry } from "@/types";

interface TranscriptViewerProps {
  transcript: TranscriptEntry[];
}

const COLLAPSED_LIMIT = 5;

export function TranscriptViewer({ transcript }: TranscriptViewerProps) {
  const [expanded, setExpanded] = useState(false);

  if (transcript.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Trascrizione</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Nessuna trascrizione disponibile
          </p>
        </CardContent>
      </Card>
    );
  }

  const isCollapsible = transcript.length > COLLAPSED_LIMIT;
  const visibleEntries = expanded || !isCollapsible
    ? transcript
    : transcript.slice(0, COLLAPSED_LIMIT);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Trascrizione</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {visibleEntries.map((entry, idx) => (
            <div
              key={idx}
              className="rounded-lg border border-border bg-muted/30 p-3"
            >
              <p className="text-sm font-semibold text-foreground">
                {entry.question}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {entry.answer}
              </p>
            </div>
          ))}
        </div>

        {isCollapsible && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-3 w-full"
            onClick={() => setExpanded((prev) => !prev)}
          >
            {expanded ? (
              <>
                <ChevronUp className="mr-1 h-4 w-4" />
                Nascondi trascrizione
              </>
            ) : (
              <>
                <ChevronDown className="mr-1 h-4 w-4" />
                Mostra trascrizione ({transcript.length - COLLAPSED_LIMIT}{" "}
                rimanenti)
              </>
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
