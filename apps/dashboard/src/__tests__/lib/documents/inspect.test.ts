// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import sharp from "sharp";

const pdfProxy = {
  numPages: 2,
  getJSActions: vi.fn(),
  getAttachments: vi.fn(),
  loadingTask: { destroy: vi.fn() },
};
vi.mock("unpdf", () => ({ getDocumentProxy: vi.fn() }));

import { getDocumentProxy } from "unpdf";
import { inspectPublicDocument, PUBLIC_MAX_PDF_PAGES } from "@/lib/documents/inspect";

const m = <T>(f: T) => f as unknown as ReturnType<typeof vi.fn>;
const enc = (s: string) => new TextEncoder().encode(s);

describe("inspectPublicDocument — PDF", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pdfProxy.numPages = 2;
    pdfProxy.getJSActions.mockResolvedValue(null);
    pdfProxy.getAttachments.mockResolvedValue(null);
    m(getDocumentProxy).mockResolvedValue(pdfProxy);
  });

  it("accepts a plain PDF unchanged", async () => {
    const bytes = enc("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj");
    const r = await inspectPublicDocument(bytes, "pdf");
    expect(r).toEqual({ ok: true, bytes, kind: "pdf" });
  });

  it.each(["/JavaScript", "/JS (app.alert(1))", "/Launch", "/EmbeddedFile", "/RichMedia", "/XFA"])(
    "rejects %s in the raw bytes",
    async (marker) => {
      const r = await inspectPublicDocument(enc(`%PDF-1.7 << ${marker} >>`), "pdf");
      expect(r).toEqual({ ok: false, reason: "pdf_active_content" });
    },
  );

  it("decodes #xx escapes in names before scanning", async () => {
    const r = await inspectPublicDocument(enc("%PDF-1.7 << /J#61vaScript >>"), "pdf");
    expect(r).toEqual({ ok: false, reason: "pdf_active_content" });
  });

  it("does not flag names that merely start with JS", async () => {
    const r = await inspectPublicDocument(enc("%PDF-1.7 << /JSONData 1 >>"), "pdf");
    expect(r.ok).toBe(true);
  });

  it("rejects an encrypted PDF", async () => {
    const r = await inspectPublicDocument(enc("%PDF-1.7 trailer << /Encrypt 5 0 R >>"), "pdf");
    expect(r).toEqual({ ok: false, reason: "pdf_encrypted" });
  });

  it("rejects active content hidden in object streams (pdf.js view)", async () => {
    pdfProxy.getJSActions.mockResolvedValueOnce({ OpenAction: ["app.alert(1)"] });
    const r = await inspectPublicDocument(enc("%PDF-1.7 /ObjStm"), "pdf");
    expect(r).toEqual({ ok: false, reason: "pdf_active_content" });
  });

  it("rejects attachments reported by pdf.js", async () => {
    pdfProxy.getAttachments.mockResolvedValueOnce({ "x.exe": {} });
    const r = await inspectPublicDocument(enc("%PDF-1.7"), "pdf");
    expect(r).toEqual({ ok: false, reason: "pdf_active_content" });
  });

  it("treats a non-empty Map of attachments as active content", async () => {
    pdfProxy.getAttachments.mockResolvedValueOnce(new Map([["x.exe", {}]]));
    const r = await inspectPublicDocument(enc("%PDF-1.7"), "pdf");
    expect(r).toEqual({ ok: false, reason: "pdf_active_content" });
  });

  it("rejects more than the page cap", async () => {
    pdfProxy.numPages = PUBLIC_MAX_PDF_PAGES + 1;
    const r = await inspectPublicDocument(enc("%PDF-1.7"), "pdf");
    expect(r).toEqual({ ok: false, reason: "pdf_too_many_pages" });
  });

  it("maps a password error to pdf_encrypted and other load errors to pdf_unreadable", async () => {
    m(getDocumentProxy).mockRejectedValueOnce(Object.assign(new Error("pw"), { name: "PasswordException" }));
    await expect(inspectPublicDocument(enc("%PDF-1.7"), "pdf")).resolves.toEqual({
      ok: false, reason: "pdf_encrypted",
    });
    m(getDocumentProxy).mockRejectedValueOnce(new Error("bad xref"));
    await expect(inspectPublicDocument(enc("%PDF-1.7"), "pdf")).resolves.toEqual({
      ok: false, reason: "pdf_unreadable",
    });
  });
});

describe("inspectPublicDocument — DOCX", () => {
  it("accepts a DOCX without active parts", async () => {
    const bytes = enc("PK\u0003\u0004word/document.xml");
    await expect(inspectPublicDocument(bytes, "docx")).resolves.toEqual({ ok: true, bytes, kind: "docx" });
  });

  it.each(["word/vbaProject.bin", "word/embeddings/oleObject1.bin", "word/activeX/activeX1.xml", "macroEnabled"])(
    "rejects %s",
    async (part) => {
      const r = await inspectPublicDocument(enc(`PK\u0003\u0004word/document.xml ${part}`), "docx");
      expect(r).toEqual({ ok: false, reason: "docx_active_content" });
    },
  );
});

describe("inspectPublicDocument — images", () => {
  it("re-encodes to JPEG and strips EXIF", async () => {
    const withExif = await sharp({
      create: { width: 20, height: 10, channels: 3, background: { r: 200, g: 0, b: 0 } },
    })
      .jpeg()
      .withExif({ IFD0: { Copyright: "secret-gps-owner" } })
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();

    const r = await inspectPublicDocument(new Uint8Array(withExif), "jpeg");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.kind).toBe("jpeg");
    const meta = await sharp(Buffer.from(r.bytes)).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.exif).toBeUndefined();
  });

  it("converts PNG to JPEG", async () => {
    const png = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 0, g: 0, b: 255 } },
    }).png().toBuffer();
    const r = await inspectPublicDocument(new Uint8Array(png), "png");
    expect(r.ok && r.kind).toBe("jpeg");
  });

  it("rejects bytes sharp cannot decode", async () => {
    const r = await inspectPublicDocument(new Uint8Array([0xff, 0xd8, 0xff, 0x00]), "jpeg");
    expect(r).toEqual({ ok: false, reason: "image_unreadable" });
  });
});
