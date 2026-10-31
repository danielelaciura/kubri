export type DocumentKind = "pdf" | "docx" | "jpeg" | "png";

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export const DOCUMENT_MIME: Record<DocumentKind, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  jpeg: "image/jpeg",
  png: "image/png",
};

function startsWith(bytes: Uint8Array, sig: readonly number[]): boolean {
  if (bytes.length < sig.length) return false;
  return sig.every((b, i) => bytes[i] === b);
}

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ZIP = [0x50, 0x4b, 0x03, 0x04];

/**
 * Identify a document by its magic bytes (never by file name or the
 * browser-supplied MIME type). Returns null for anything we don't accept,
 * including legacy binary .doc files.
 */
export function detectDocumentKind(bytes: Uint8Array): DocumentKind | null {
  if (startsWith(bytes, PDF)) return "pdf";
  if (startsWith(bytes, JPEG)) return "jpeg";
  if (startsWith(bytes, PNG)) return "png";
  if (startsWith(bytes, ZIP)) {
    // DOCX is a zip whose entry names include "word/…". Entry names are
    // stored uncompressed in local file headers, so a byte scan finds them.
    const text = new TextDecoder("latin1").decode(bytes);
    return text.includes("word/") ? "docx" : null;
  }
  return null;
}
