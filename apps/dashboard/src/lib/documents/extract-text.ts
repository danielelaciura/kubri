import { extractText as extractPdfText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";
import { DOCUMENT_MIME, type DocumentKind } from "./detect";
import { DocumentError } from "./errors";
import { ocrDocument } from "./ocr";

/** Below this many non-whitespace chars a PDF is treated as scanned. */
const MIN_PDF_TEXT_CHARS = 200;

export interface ExtractedText {
  text: string;
  method: "pdf" | "docx" | "ocr";
  pageCount: number | null;
}

/**
 * File bytes → plain text. Digital PDFs and DOCX are parsed locally (fast,
 * free); images and PDFs without a usable text layer go through Mistral OCR.
 * Throws DocumentError (FILE_UNREADABLE / NO_TEXT) or LLMError (OCR transport).
 */
export async function extractDocumentText(
  bytes: Uint8Array,
  kind: DocumentKind,
): Promise<ExtractedText> {
  switch (kind) {
    case "pdf": {
      let text: string;
      let pageCount: number;
      try {
        // getDocumentProxy takes ownership of the buffer: pass a copy.
        const pdf = await getDocumentProxy(new Uint8Array(bytes));
        const r = await extractPdfText(pdf, { mergePages: true });
        text = r.text.trim();
        pageCount = r.totalPages;
      } catch (e) {
        throw new DocumentError("FILE_UNREADABLE", e);
      }
      if (text.replace(/\s+/g, "").length >= MIN_PDF_TEXT_CHARS) {
        return { text, method: "pdf", pageCount };
      }
      return ocrOrThrow(bytes, kind);
    }
    case "docx": {
      let text: string;
      try {
        const r = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
        text = r.value.trim();
      } catch (e) {
        throw new DocumentError("FILE_UNREADABLE", e);
      }
      if (!text) throw new DocumentError("NO_TEXT");
      return { text, method: "docx", pageCount: null };
    }
    case "jpeg":
    case "png":
      return ocrOrThrow(bytes, kind);
  }
}

async function ocrOrThrow(bytes: Uint8Array, kind: DocumentKind): Promise<ExtractedText> {
  const r = await ocrDocument(bytes, DOCUMENT_MIME[kind]);
  const text = r.text.trim();
  if (!text) throw new DocumentError("NO_TEXT");
  return { text, method: "ocr", pageCount: r.pageCount };
}
