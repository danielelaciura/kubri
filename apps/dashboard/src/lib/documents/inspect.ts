import JSZip from "jszip";
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
const PDF_ACTIVE_NAME =
  /\/(?:JavaScript|JS|Launch|EmbeddedFile|RichMedia|XFA|SubmitForm|ImportData|GoToE)(?![A-Za-z0-9])/;
const PDF_ENCRYPT_NAME = /\/Encrypt(?![A-Za-z0-9])/;
const SAFE_URL_SCHEME = /^(?:https?|mailto|tel):/i;
const HYPERLINK_REL = /\/relationships\/hyperlink$/i;
const DANGEROUS_REL = /\/(?:aFChunk|oleObject|subDocument|frame|attachedTemplate)$/i;
const DOCX_ACTIVE_ENTRY = /vbaProject\.bin|activeX|embeddings\/|\.bin$/i;
const DOCX_ACTIVE_CT = /vbaProject|oleObject|activeX|macroEnabled/i;
const DOCX_ACTIVE_FIELD = /DDE|INCLUDETEXT|INCLUDEPICTURE/i;

/** Hard time bound for work on hostile input. */
export const PDF_TIMEOUT_MS = 10_000;
const IMAGE_TIMEOUT_SECONDS = 10;
const DOCX_MAX_ENTRIES = 500;
const DOCX_MAX_TOTAL_BYTES = 30 * 1024 * 1024;

/** Single-byte decode, with PDF stream bodies removed and #xx name escapes undone. */
function pdfText(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("latin1")
    .replace(/stream\r?\n[\s\S]*?endstream/g, "")
    .replace(/#([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (v instanceof Map || v instanceof Set) return v.size === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
  return false;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function annotationIsActive(a: unknown): boolean {
  if (typeof a !== "object" || a === null) return false;
  const r = a as Record<string, unknown>;
  if (r["subtype"] === "FileAttachment") return true;
  if (!isEmpty(r["actions"])) return true;
  for (const key of ["unsafeUrl", "url"]) {
    const u = str(r[key]);
    if (u !== null && !SAFE_URL_SCHEME.test(u)) return true;
  }
  return false;
}

type PdfDoc = Awaited<ReturnType<typeof getDocumentProxy>>;

async function checkPdfDoc(pdf: PdfDoc): Promise<InspectRejectReason | null> {
  if (pdf.numPages > PUBLIC_MAX_PDF_PAGES) return "pdf_too_many_pages";
  const [js, attachments] = await Promise.all([pdf.getJSActions(), pdf.getAttachments()]);
  if (!isEmpty(js) || !isEmpty(attachments)) return "pdf_active_content";
  for (let i = 1; i <= pdf.numPages; i++) {
    const annotations: unknown[] = await (await pdf.getPage(i)).getAnnotations();
    if (annotations.some(annotationIsActive)) return "pdf_active_content";
  }
  return null;
}

async function inspectPdfWithPdfJs(bytes: Uint8Array): Promise<InspectResult> {
  let pdf: PdfDoc;
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes));
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    return { ok: false, reason: name === "PasswordException" ? "pdf_encrypted" : "pdf_unreadable" };
  }
  try {
    const reason = await checkPdfDoc(pdf);
    return reason ? { ok: false, reason } : { ok: true, bytes, kind: "pdf" };
  } catch {
    return { ok: false, reason: "pdf_unreadable" };
  } finally {
    await pdf.loadingTask.destroy().catch(() => {});
  }
}

async function inspectPdf(bytes: Uint8Array): Promise<InspectResult> {
  const text = pdfText(bytes);
  if (PDF_ENCRYPT_NAME.test(text)) return { ok: false, reason: "pdf_encrypted" };
  if (PDF_ACTIVE_NAME.test(text)) return { ok: false, reason: "pdf_active_content" };

  // The byte scan misses names inside compressed object streams and page
  // annotations: ask pdf.js too, bounded in time (it keeps cleaning up late).
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<InspectResult>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, reason: "pdf_unreadable" }), PDF_TIMEOUT_MS);
  });
  try {
    return await Promise.race([inspectPdfWithPdfJs(bytes), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function xmlAttr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}="([^"]*)"`, "i").exec(tag);
  return m ? (m[1] ?? "") : null;
}

function relsAreActive(xml: string): boolean {
  for (const tag of xml.match(/<Relationship\b[^>]*>/gi) ?? []) {
    const type = xmlAttr(tag, "Type") ?? "";
    if (DANGEROUS_REL.test(type)) return true;
    if (/^external$/i.test(xmlAttr(tag, "TargetMode") ?? "") && !HYPERLINK_REL.test(type)) return true;
  }
  return false;
}

function fieldsAreActive(xml: string): boolean {
  // Field codes can be split across runs: join them before matching.
  const instr = [...xml.matchAll(/<w:instrText\b[^>]*>([^<]*)</g)].map((m) => m[1] ?? "").join("");
  const simple = [...xml.matchAll(/<w:fldSimple\b[^>]*\bw:instr="([^"]*)"/g)].map((m) => m[1] ?? "").join("");
  return DOCX_ACTIVE_FIELD.test(instr) || DOCX_ACTIVE_FIELD.test(simple);
}

function declaredSize(entry: JSZip.JSZipObject): number | null {
  const data = (entry as unknown as { _data?: { uncompressedSize?: unknown } })._data;
  return typeof data?.uncompressedSize === "number" ? data.uncompressedSize : null;
}

async function inspectDocx(bytes: Uint8Array): Promise<InspectResult> {
  const reject: InspectResult = { ok: false, reason: "docx_active_content" };
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    return reject;
  }
  const entries = Object.values(zip.files).filter((f) => !f.dir);
  if (Object.keys(zip.files).length > DOCX_MAX_ENTRIES) return reject;

  // Fail closed when a size is unknown; only small XML parts are ever inflated.
  let total = 0;
  for (const e of entries) {
    const size = declaredSize(e);
    if (size === null) return reject;
    total += size;
    if (total > DOCX_MAX_TOTAL_BYTES) return reject;
    if (DOCX_ACTIVE_ENTRY.test(e.name)) return reject;
  }

  try {
    for (const e of entries) {
      const isCt = e.name === "[Content_Types].xml";
      const isRels = /\.rels$/i.test(e.name);
      const isBody = /^word\/(?:document|header\d*|footer\d*)\.xml$/i.test(e.name);
      if (!isCt && !isRels && !isBody) continue;
      const xml = await e.async("string");
      if (isCt && DOCX_ACTIVE_CT.test(xml)) return reject;
      if (isRels && relsAreActive(xml)) return reject;
      if (isBody && fieldsAreActive(xml)) return reject;
    }
  } catch {
    return reject;
  }
  return { ok: true, bytes, kind: "docx" };
}

/**
 * Re-encode to JPEG: drops EXIF (incl. GPS) and anything appended to or
 * smuggled inside the original (polyglot files). Output replaces the upload.
 */
async function reencodeImage(bytes: Uint8Array): Promise<InspectResult> {
  try {
    const out = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" })
      .timeout({ seconds: IMAGE_TIMEOUT_SECONDS })
      .rotate()
      .resize({ width: MAX_IMAGE_SIDE, height: MAX_IMAGE_SIDE, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
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
    case "docx":
      return inspectDocx(bytes);
    case "jpeg":
    case "png":
      return reencodeImage(bytes);
  }
}
