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
const DOCX_ACTIVE_ENTRY = /vbaProject\.bin|activeX|embeddings\/|oleObject/i;
const DOCX_ACTIVE_CT = /vbaProject|oleObject|activeX|macroEnabled/i;
// INCLUDEPICTURE fetches a remote resource, so it is rejected deliberately even
// though that may refuse some CVs with web-pasted images.
const DOCX_ACTIVE_FIELD = /\b(?:DDE|DDEAUTO|INCLUDETEXT|INCLUDEPICTURE)\b/i;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Hard time bound for work on hostile input. */
export const PDF_TIMEOUT_MS = 10_000;
const IMAGE_TIMEOUT_SECONDS = 10;
const DOCX_MAX_ENTRIES = 500;
const DOCX_MAX_TOTAL_BYTES = 30 * 1024 * 1024;
const DOCX_MAX_PART_BYTES = 10 * 1024 * 1024;

/** Single-byte decode, with PDF stream bodies removed and #xx name escapes undone. */
function pdfText(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("latin1")
    // Only after a dictionary end: makes it harder to hide names behind a fake "stream" in a string.
    .replace(/>>\s*stream\r?\n[\s\S]*?endstream/g, ">>")
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
    if (u !== null && URL_SCHEME.test(u) && !SAFE_URL_SCHEME.test(u)) return true;
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

async function inspectPdfWithPdfJs(
  bytes: Uint8Array,
  held: { pdf?: PdfDoc },
): Promise<InspectResult> {
  let pdf: PdfDoc;
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes));
    held.pdf = pdf;
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
  // A hang inside getDocumentProxy itself cannot be cancelled (unpdf does not expose the
  // loading task until it resolves).
  // Note: pdf.js runs on this thread, so the timeout only bounds work that yields.
  const held: { pdf?: PdfDoc } = {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<InspectResult>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, reason: "pdf_unreadable" }), PDF_TIMEOUT_MS);
  });
  try {
    const result = await Promise.race([inspectPdfWithPdfJs(bytes, held), timeout]);
    if (!result.ok && result.reason === "pdf_unreadable") {
      await held.pdf?.loadingTask.destroy().catch(() => {});
    }
    return result;
  } finally {
    clearTimeout(timer);
  }
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** Decode character references and the 5 named entities (attackers use them to hide keywords). */
function decodeXml(v: string): string {
  return v.replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|(amp|lt|gt|quot|apos));/g, (m, dec, hex, named) => {
    if (named) return ENTITIES[named as string] ?? m;
    const code = dec !== undefined ? parseInt(dec as string, 10) : parseInt(hex as string, 16);
    return code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
}

const TAG_BODY = `(?:[^>"']|"[^"]*"|'[^']*')*`;

/**
 * Attributes parsed sequentially from the tag start (so a value containing
 * "Type='…'" cannot be mistaken for an attribute), keyed by local name.
 */
function xmlAttrs(tag: string): Map<string, string> {
  const out = new Map<string, string>();
  const body = tag.replace(/^<[^\s>/]+/, "");
  for (const m of body.matchAll(/([\w.:-]+)\s*=\s*(["'])([\s\S]*?)\2/g)) {
    const local = (m[1] ?? "").replace(/^.*:/, "");
    if (!out.has(local)) out.set(local, decodeXml(m[3] ?? ""));
  }
  return out;
}

/** Word never writes these; they enable keyword hiding and entity definitions. */
const XML_MARKUP_TRICKS = /<!\[CDATA\[|<!--|<!DOCTYPE/i;

function relsAreActive(xml: string): boolean {
  for (const m of xml.matchAll(new RegExp(`<(?:[\\w.-]+:)?Relationship\\b${TAG_BODY}>`, "gi"))) {
    const tag = m[0];
    const attrs = xmlAttrs(tag);
    const type = attrs.get("Type") ?? "";
    if (DANGEROUS_REL.test(type)) return true;
    if (/^external$/i.test(attrs.get("TargetMode") ?? "") && !HYPERLINK_REL.test(type)) return true;
  }
  return false;
}

function fieldsAreActive(xml: string): boolean {
  // Never match across fields: split at each field start, join runs only within one.
  for (const field of xml.split(/fldCharType\s*=\s*["']begin["']/i)) {
    const runs = [...field.matchAll(/<(?:[\w.-]+:)?instrText\b[^>]*>([^<]*)</g)].map((m) => decodeXml(m[1] ?? ""));
    if (DOCX_ACTIVE_FIELD.test(runs.join(""))) return true;
    if (runs.some((r) => DOCX_ACTIVE_FIELD.test(r))) return true;
  }
  for (const m of xml.matchAll(new RegExp(`<(?:[\\w.-]+:)?fldSimple\\b${TAG_BODY}>`, "gi"))) {
    if (DOCX_ACTIVE_FIELD.test(xmlAttrs(m[0]).get("instr") ?? "")) return true;
  }
  return false;
}

/**
 * Inflate one part as a stream, counting bytes. Declared sizes are
 * attacker-controlled, so abort as soon as a cap is crossed. Returns null when
 * over budget.
 */
// internalStream exists at runtime (jszip 3.x) but is missing from its typings.
interface StreamingEntry {
  internalStream(type: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array>;
}

function readPart(entry: JSZip.JSZipObject, budget: { left: number }): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let part = 0;
    const helper = (entry as unknown as StreamingEntry).internalStream("uint8array");
    helper
      .on("data", (chunk: Uint8Array) => {
        part += chunk.length;
        budget.left -= chunk.length;
        if (part > DOCX_MAX_PART_BYTES || budget.left < 0) {
          helper.pause();
          resolve(null);
          return;
        }
        chunks.push(chunk);
      })
      .on("error", reject)
      .on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
      .resume();
  });
}

async function inspectDocx(bytes: Uint8Array): Promise<InspectResult> {
  const reject: InspectResult = { ok: false, reason: "docx_active_content" };
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    return reject;
  }
  if (Object.keys(zip.files).length > DOCX_MAX_ENTRIES) return reject;
  const entries = Object.values(zip.files).filter((f) => !f.dir);
  if (entries.some((e) => DOCX_ACTIVE_ENTRY.test(e.name))) return reject;

  const budget = { left: DOCX_MAX_TOTAL_BYTES };
  try {
    for (const e of entries) {
      const isCt = e.name === "[Content_Types].xml";
      const isRels = /\.rels$/i.test(e.name);
      const isBody = /^word\/.*\.xml$/i.test(e.name);
      if (!isCt && !isRels && !isBody) continue;
      const xml = await readPart(e, budget);
      if (xml === null || XML_MARKUP_TRICKS.test(xml)) return reject;
      if (isCt && DOCX_ACTIVE_CT.test(decodeXml(xml))) return reject;
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
