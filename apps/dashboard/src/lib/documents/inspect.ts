import sharp from "sharp";
import { getDocumentProxy } from "unpdf";
import type { DocumentKind } from "./detect";

/** Public uploads only: a CV longer than this is not what we are looking for. */
export const PUBLIC_MAX_PDF_PAGES = 5;
const MAX_IMAGE_SIDE = 3000;
/** Decompression-bomb guard for images (~40 MP). */
const MAX_INPUT_PIXELS = 40_000_000;

export type InspectRejectReason =
  | "pdf_active_content"
  | "pdf_encrypted"
  | "pdf_too_many_pages"
  | "pdf_unreadable"
  | "docx_active_content"
  | "image_unreadable";

export type InspectResult =
  | { ok: true; bytes: Uint8Array; kind: DocumentKind }
  | { ok: false; reason: InspectRejectReason };

// A PDF name ends at a delimiter, so "/JS" must not match "/JSONData".
const PDF_ACTIVE_NAME = /\/(?:JavaScript|JS|Launch|EmbeddedFile|RichMedia|XFA)(?![A-Za-z0-9])/;
const PDF_ENCRYPT_NAME = /\/Encrypt(?![A-Za-z0-9])/;
const DOCX_ACTIVE_PART = /vbaProject\.bin|word\/embeddings\/|word\/activeX\/|macroEnabled/i;

/** PDF names may hex-escape characters ("/J#61vaScript"); undo that before scanning. */
function pdfText(bytes: Uint8Array): string {
  return new TextDecoder("latin1")
    .decode(bytes)
    .replace(/#([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (v instanceof Map || v instanceof Set) return v.size === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
  return false;
}

async function inspectPdf(bytes: Uint8Array): Promise<InspectResult> {
  const text = pdfText(bytes);
  if (PDF_ENCRYPT_NAME.test(text)) return { ok: false, reason: "pdf_encrypted" };
  if (PDF_ACTIVE_NAME.test(text)) return { ok: false, reason: "pdf_active_content" };

  // The byte scan misses names inside compressed object streams: ask pdf.js too.
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes));
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    return { ok: false, reason: name === "PasswordException" ? "pdf_encrypted" : "pdf_unreadable" };
  }
  try {
    if (pdf.numPages > PUBLIC_MAX_PDF_PAGES) return { ok: false, reason: "pdf_too_many_pages" };
    const [js, attachments] = await Promise.all([pdf.getJSActions(), pdf.getAttachments()]);
    if (!isEmpty(js) || !isEmpty(attachments)) return { ok: false, reason: "pdf_active_content" };
    return { ok: true, bytes, kind: "pdf" };
  } catch {
    return { ok: false, reason: "pdf_unreadable" };
  } finally {
    await pdf.loadingTask.destroy();
  }
}

/**
 * Re-encode to JPEG: drops EXIF (incl. GPS) and anything appended to or
 * smuggled inside the original (polyglot files). Output replaces the upload.
 */
async function reencodeImage(bytes: Uint8Array): Promise<InspectResult> {
  try {
    const out = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize({ width: MAX_IMAGE_SIDE, height: MAX_IMAGE_SIDE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    return { ok: true, bytes: new Uint8Array(out), kind: "jpeg" };
  } catch {
    return { ok: false, reason: "image_unreadable" };
  }
}

/**
 * Extra checks for files uploaded by anonymous visitors (public landing).
 * The server never executes these files; the checks protect the operator who
 * later downloads them. Returns the bytes to store (re-encoded for images).
 */
export async function inspectPublicDocument(
  bytes: Uint8Array,
  kind: DocumentKind,
): Promise<InspectResult> {
  switch (kind) {
    case "pdf":
      return inspectPdf(bytes);
    case "docx": {
      // Zip entry names are stored uncompressed in local headers: a byte scan finds them.
      const names = new TextDecoder("latin1").decode(bytes);
      return DOCX_ACTIVE_PART.test(names)
        ? { ok: false, reason: "docx_active_content" }
        : { ok: true, bytes, kind };
    }
    case "jpeg":
    case "png":
      return reencodeImage(bytes);
  }
}
