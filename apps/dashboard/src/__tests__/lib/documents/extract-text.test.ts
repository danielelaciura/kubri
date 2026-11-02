import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("unpdf", () => ({ getDocumentProxy: vi.fn(), extractText: vi.fn() }));
vi.mock("mammoth", () => ({ default: { extractRawText: vi.fn() } }));
vi.mock("@/lib/documents/ocr", () => ({ ocrDocument: vi.fn() }));

import { getDocumentProxy, extractText } from "unpdf";
import mammoth from "mammoth";
import { ocrDocument } from "@/lib/documents/ocr";
import { extractDocumentText } from "@/lib/documents/extract-text";
import { DocumentError } from "@/lib/documents/errors";

const proxy = getDocumentProxy as unknown as ReturnType<typeof vi.fn>;
const pdfText = extractText as unknown as ReturnType<typeof vi.fn>;
const docx = mammoth.extractRawText as unknown as ReturnType<typeof vi.fn>;
const ocr = ocrDocument as unknown as ReturnType<typeof vi.fn>;
const destroy = vi.fn();
const BYTES = new Uint8Array([1, 2, 3]);
const LONG = "Esperienza magazziniere ".repeat(20);

describe("extractDocumentText", () => {
  beforeEach(() => vi.resetAllMocks());

  it("uses the PDF text layer when it has enough text", async () => {
    proxy.mockResolvedValueOnce({ loadingTask: { destroy } });
    pdfText.mockResolvedValueOnce({ totalPages: 2, text: LONG });
    const r = await extractDocumentText(BYTES, "pdf");
    expect(r).toEqual({ text: LONG.trim(), method: "pdf", pageCount: 2 });
    expect(ocr).not.toHaveBeenCalled();
  });

  it("falls back to OCR for a scanned PDF (near-empty text layer)", async () => {
    proxy.mockResolvedValueOnce({ loadingTask: { destroy } });
    pdfText.mockResolvedValueOnce({ totalPages: 1, text: "  \n " });
    ocr.mockResolvedValueOnce({ text: "Mario Rossi", pageCount: 1 });
    const r = await extractDocumentText(BYTES, "pdf");
    expect(r).toEqual({ text: "Mario Rossi", method: "ocr", pageCount: 1 });
    expect(ocr).toHaveBeenCalledWith(BYTES, "application/pdf", undefined, undefined);
  });

  it("maps an unparseable PDF to FILE_UNREADABLE", async () => {
    proxy.mockRejectedValueOnce(new Error("PasswordException"));
    await expect(extractDocumentText(BYTES, "pdf")).rejects.toMatchObject({
      code: "FILE_UNREADABLE",
    });
  });

  it("extracts DOCX with mammoth", async () => {
    docx.mockResolvedValueOnce({ value: " Testo CV " });
    const r = await extractDocumentText(BYTES, "docx");
    expect(r).toEqual({ text: "Testo CV", method: "docx", pageCount: null });
  });

  it("maps an empty DOCX to NO_TEXT", async () => {
    docx.mockResolvedValueOnce({ value: "   " });
    await expect(extractDocumentText(BYTES, "docx")).rejects.toMatchObject({ code: "NO_TEXT" });
  });

  it("OCRs images and maps empty OCR output to NO_TEXT", async () => {
    ocr.mockResolvedValueOnce({ text: "", pageCount: 1 });
    const p = extractDocumentText(BYTES, "jpeg");
    await expect(p).rejects.toBeInstanceOf(DocumentError);
    await expect(p).rejects.toMatchObject({ code: "NO_TEXT" });
    expect(ocr).toHaveBeenCalledWith(BYTES, "image/jpeg", undefined, undefined);
  });

  it("sends a multi-page PDF with a thin text layer to OCR and frees pdf.js", async () => {
    proxy.mockResolvedValueOnce({ loadingTask: { destroy } });
    pdfText.mockResolvedValueOnce({ totalPages: 3, text: "a".repeat(250) });
    ocr.mockResolvedValueOnce({ text: "scanned", pageCount: 3 });
    const r = await extractDocumentText(BYTES, "pdf");
    expect(r.method).toBe("ocr");
    expect(destroy).toHaveBeenCalled();
  });

  it("falls back to the local text when OCR fails", async () => {
    proxy.mockResolvedValueOnce({ loadingTask: { destroy } });
    pdfText.mockResolvedValueOnce({ totalPages: 1, text: "b".repeat(50) });
    ocr.mockRejectedValueOnce(new Error("ocr down"));
    const r = await extractDocumentText(BYTES, "pdf");
    expect(r).toEqual({ text: "b".repeat(50), method: "pdf", pageCount: 1 });
  });

  it("falls back to the local text when OCR returns nothing", async () => {
    proxy.mockResolvedValueOnce({ loadingTask: { destroy } });
    pdfText.mockResolvedValueOnce({ totalPages: 1, text: "b".repeat(50) });
    ocr.mockResolvedValueOnce({ text: "", pageCount: 1 });
    const r = await extractDocumentText(BYTES, "pdf");
    expect(r.method).toBe("pdf");
  });

  it("throws NO_TEXT when both the text layer and OCR are empty", async () => {
    proxy.mockResolvedValueOnce({ loadingTask: { destroy } });
    pdfText.mockResolvedValueOnce({ totalPages: 1, text: "" });
    ocr.mockResolvedValueOnce({ text: "", pageCount: 1 });
    await expect(extractDocumentText(BYTES, "pdf")).rejects.toMatchObject({ code: "NO_TEXT" });
  });

  it("passes maxOcrPages through to OCR for images", async () => {
    ocr.mockResolvedValueOnce({ text: "testo letto", pageCount: 1 });
    await extractDocumentText(BYTES, "jpeg", { maxOcrPages: 3 });
    expect(ocr).toHaveBeenCalledWith(BYTES, "image/jpeg", undefined, 3);
  });
});
