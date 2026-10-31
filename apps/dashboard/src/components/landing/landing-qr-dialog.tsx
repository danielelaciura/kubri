"use client";

import { useEffect, useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useT } from "@/lib/i18n/provider";

export function LandingQrDialog({ name, url }: { name: string; url: string }) {
  const t = useT().landingAdmin;
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      return; // clipboard unavailable or denied: the link stays visible to copy by hand
    }
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 1500);
  }

  function downloadPng() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `kubri-landing-${url.split("/").pop() ?? "qr"}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            {t.showQr}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.qrTitle.replace("{name}", name)}</DialogTitle>
          <DialogDescription>{t.qrDescription}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-2">
          <div className="rounded-md bg-white p-4">
            <QRCodeCanvas
              ref={canvasRef}
              value={url}
              size={240}
              level="M"
              marginSize={2}
              role="img"
              aria-label={url}
            />
          </div>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="block w-full break-all rounded border bg-muted/40 p-2 font-mono text-xs hover:underline"
          >
            {url}
          </a>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={copy}>
              <span aria-live="polite">{copied ? t.copied : t.copyLink}</span>
            </Button>
            <Button type="button" variant="outline" onClick={downloadPng}>
              {t.downloadPng}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
