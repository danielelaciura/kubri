"use client";

import { useRef, useState } from "react";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type Props = {
  poolName: string;
  waLink: string | null;
  messageText: string | null;
  disabledReason?: string;
};

export function PoolQrDialog({
  poolName,
  waLink,
  messageText,
  disabledReason,
}: Props) {
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  function downloadPng() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL("image/png");
    const safeName =
      poolName
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "pool";
    const a = document.createElement("a");
    a.href = url;
    a.download = `kubri-qr-${safeName}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  if (!waLink || !messageText) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger
            render={
              <span>
                <Button variant="outline" size="sm" disabled>
                  QR WhatsApp
                </Button>
              </span>
            }
          />
          <TooltipContent>
            {disabledReason ??
              "Configurare KUBRI_WHATSAPP_NUMBER e KUBRI_WHATSAPP_MESSAGE_TEMPLATE"}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  async function copy() {
    if (!waLink) return;
    await navigator.clipboard.writeText(waLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            QR WhatsApp
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>QR WhatsApp — {poolName}</DialogTitle>
          <DialogDescription>
            Inquadra il QR per aprire WhatsApp con il messaggio precompilato.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-2">
          <div className="rounded-md bg-white p-4">
            <QRCodeCanvas
              ref={canvasRef}
              value={waLink}
              size={240}
              level="M"
              marginSize={2}
            />
          </div>
          <div className="w-full space-y-2">
            <div className="text-xs text-muted-foreground">Messaggio</div>
            <div className="rounded border bg-muted/40 p-2 text-sm whitespace-pre-wrap break-words">
              {messageText}
            </div>
          </div>
          <div className="w-full space-y-2">
            <div className="text-xs text-muted-foreground">Link</div>
            <a
              href={waLink}
              target="_blank"
              rel="noreferrer"
              className="block break-all rounded border bg-muted/40 p-2 font-mono text-xs hover:underline"
            >
              {waLink}
            </a>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={copy}>
              {copied ? "Copiato!" : "Copia link"}
            </Button>
            <Button type="button" variant="outline" onClick={downloadPng}>
              Scarica PNG
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
