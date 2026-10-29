// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import sharp from "sharp";
import JSZip from "jszip";

const pdfProxy = {
  numPages: 2,
  getJSActions: vi.fn(),
  getAttachments: vi.fn(),
  loadingTask: { destroy: vi.fn() },
  getPage: vi.fn(),
};
const getAnnotations = vi.fn();
vi.mock("unpdf", () => ({ getDocumentProxy: vi.fn() }));

import { getDocumentProxy } from "unpdf";
import { inspectPublicDocument, PUBLIC_MAX_PDF_PAGES, PDF_TIMEOUT_MS } from "@/lib/documents/inspect";

const m = <T>(f: T) => f as unknown as ReturnType<typeof vi.fn>;
const enc = (s: string) => new TextEncoder().encode(s);

describe("inspectPublicDocument — PDF", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pdfProxy.numPages = 2;
    pdfProxy.getJSActions.mockResolvedValue(null);
    pdfProxy.getAttachments.mockResolvedValue(null);
    pdfProxy.loadingTask.destroy.mockResolvedValue(undefined);
    getAnnotations.mockResolvedValue([]);
    pdfProxy.getPage.mockResolvedValue({ getAnnotations });
    m(getDocumentProxy).mockResolvedValue(pdfProxy);
  });

  it("ignores marker-like bytes inside stream bodies", async () => {
    const bytes = enc("%PDF-1.7\n1 0 obj << /Length 9 >>\nstream\nabc /JS  /Encrypt \nendstream\nendobj");
    expect((await inspectPublicDocument(bytes, "pdf")).ok).toBe(true);
  });

  it.each(["/SubmitForm", "/ImportData", "/GoToE"])("rejects %s", async (marker) => {
    const r = await inspectPublicDocument(enc(`%PDF-1.7 << ${marker} >>`), "pdf");
    expect(r).toEqual({ ok: false, reason: "pdf_active_content" });
  });

  it("rejects FileAttachment annotations", async () => {
    getAnnotations.mockResolvedValueOnce([{ subtype: "FileAttachment" }]);
    const r = await inspectPublicDocument(enc("%PDF-1.7"), "pdf");
    expect(r).toEqual({ ok: false, reason: "pdf_active_content" });
  });

  it("rejects annotations with actions", async () => {
    getAnnotations.mockResolvedValueOnce([{ subtype: "Link", actions: { Action: ["x"] } }]);
    const r = await inspectPublicDocument(enc("%PDF-1.7"), "pdf");
    expect(r).toEqual({ ok: false, reason: "pdf_active_content" });
  });

  it("rejects links with a non-web scheme", async () => {
    getAnnotations.mockResolvedValueOnce([{ subtype: "Link", unsafeUrl: "file:///etc/passwd" }]);
    const r = await inspectPublicDocument(enc("%PDF-1.7"), "pdf");
    expect(r).toEqual({ ok: false, reason: "pdf_active_content" });
  });

  it("accepts scheme-less links but rejects javascript:", async () => {
    getAnnotations.mockResolvedValueOnce([{ subtype: "Link", unsafeUrl: "www.linkedin.com/in/x" }]);
    expect((await inspectPublicDocument(enc("%PDF-1.7"), "pdf")).ok).toBe(true);
    getAnnotations.mockResolvedValueOnce([{ subtype: "Link", unsafeUrl: "javascript:alert(1)" }]);
    expect(await inspectPublicDocument(enc("%PDF-1.7"), "pdf")).toEqual({
      ok: false, reason: "pdf_active_content",
    });
  });

  it("does not let a fake stream keyword hide names", async () => {
    const r = await inspectPublicDocument(enc("%PDF-1.7 (stream\n) /JS (endstream)"), "pdf");
    expect(r).toEqual({ ok: false, reason: "pdf_active_content" });
  });

  it("accepts plain https links", async () => {
    getAnnotations.mockResolvedValue([{ subtype: "Link", url: "https://example.com", actions: {} }]);
    const r = await inspectPublicDocument(enc("%PDF-1.7"), "pdf");
    expect(r.ok).toBe(true);
  });

  it("destroys the loading task when the checks time out", async () => {
    vi.useFakeTimers();
    try {
      pdfProxy.getJSActions.mockReturnValueOnce(new Promise(() => {}));
      const p = inspectPublicDocument(enc("%PDF-1.7"), "pdf");
      await vi.advanceTimersByTimeAsync(PDF_TIMEOUT_MS + 1);
      await expect(p).resolves.toEqual({ ok: false, reason: "pdf_unreadable" });
      expect(pdfProxy.loadingTask.destroy).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out hostile PDFs as pdf_unreadable", async () => {
    vi.useFakeTimers();
    try {
      m(getDocumentProxy).mockReturnValueOnce(new Promise(() => {}));
      const p = inspectPublicDocument(enc("%PDF-1.7"), "pdf");
      await vi.advanceTimersByTimeAsync(PDF_TIMEOUT_MS + 1);
      await expect(p).resolves.toEqual({ ok: false, reason: "pdf_unreadable" });
    } finally {
      vi.useRealTimers();
    }
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

const CT = '<Types><Override PartName="/word/document.xml" ContentType="x"/></Types>';
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
async function makeDocx(opts: {
  rels?: string;
  document?: string;
  extra?: Record<string, string>;
  contentTypes?: string;
} = {}): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", opts.contentTypes ?? CT);
  zip.file("word/document.xml", opts.document ?? "<w:document><w:body><w:p/></w:body></w:document>");
  zip.file("word/_rels/document.xml.rels", `<Relationships>${opts.rels ?? ""}</Relationships>`);
  for (const [k, v] of Object.entries(opts.extra ?? {})) zip.file(k, v);
  return zip.generateAsync({ type: "uint8array" });
}
const rel = (type: string, target: string, external = false) =>
  `<Relationship Id="r1" Type="${REL_NS}/${type}" Target="${target}"${external ? ' TargetMode="External"' : ""}/>`;

describe("inspectPublicDocument — DOCX", () => {
  it("accepts a clean DOCX", async () => {
    const bytes = await makeDocx();
    await expect(inspectPublicDocument(bytes, "docx")).resolves.toEqual({ ok: true, bytes, kind: "docx" });
  });

  it("accepts an external hyperlink", async () => {
    const bytes = await makeDocx({ rels: rel("hyperlink", "https://example.com", true) });
    expect((await inspectPublicDocument(bytes, "docx")).ok).toBe(true);
  });

  const rejected: Array<[string, Parameters<typeof makeDocx>[0]]> = [
    ["external attachedTemplate", { rels: rel("attachedTemplate", "https://evil/t.dotm", true) }],
    ["external image", { rels: rel("image", "https://evil/a.png", true) }],
    ["internal oleObject", { rels: rel("oleObject", "embed.bin") }],
    ["aFChunk", { rels: rel("aFChunk", "chunk.html") }],
    ["subDocument", { rels: rel("subDocument", "x.docx") }],
    ["vbaProject.bin entry", { extra: { "word/vbaProject.bin": "x" } }],
    ["embeddings entry", { extra: { "word/embeddings/o.dat": "x" } }],
    ["char-ref DDE", { document: "<w:document><w:instrText>&#68;DEAUTO x</w:instrText></w:document>" }],
    ["hex char-ref DDE", { document: "<w:document><w:instrText>&#x44;DE x</w:instrText></w:document>" }],
    ["char-ref TargetMode", { rels: '<Relationship Type="x/image" Target="http://e" TargetMode="&#69;xternal"/>' }],
    ["char-ref rel Type", { rels: `<Relationship Type="${REL_NS}/oleObjec&#116;" Target="a"/>` }],
    ["single-quoted TargetMode", { rels: `<Relationship Type='${REL_NS}/image' Target='http://e' TargetMode='External'/>` }],
    ["other prefix instrText", { document: "<x:document><q:instrText>DDEAUTO</q:instrText></x:document>" }],
    ["other prefix fldSimple", { document: '<x:document><q:fldSimple q:instr="DDE a"/></x:document>' }],
    ["other prefix Relationship", { rels: `<r:Relationship Type="${REL_NS}/image" Target="h" TargetMode="External"/>` }],
    ["DDE in footnotes", { extra: { "word/footnotes.xml": "<w:footnotes><w:instrText>DDEAUTO</w:instrText></w:footnotes>" } }],
    ["external rel in another part's rels", { extra: { "word/_rels/footnotes.xml.rels": `<Relationships>${rel("image", "http://e", true)}</Relationships>` } }],
    ["oversized part", { document: "a".repeat(12 * 1024 * 1024) }],
    ["macroEnabled content type", { contentTypes: "<Types>macroEnabled.main+xml</Types>" }],
    [
      "DDEAUTO field",
      { document: '<w:document><w:instrText xml:space="preserve"> DDEAUTO c:\\x "a" </w:instrText></w:document>' },
    ],
    [
      "split DDE field",
      { document: "<w:document><w:instrText>DD</w:instrText><w:instrText>E x</w:instrText></w:document>" },
    ],
    ["fldSimple INCLUDETEXT", { document: '<w:document><w:fldSimple w:instr=" INCLUDETEXT http://x "/></w:document>' }],
  ];
  it.each(rejected)("rejects %s", async (_n, opts) => {
    const r = await inspectPublicDocument(await makeDocx(opts), "docx");
    expect(r).toEqual({ ok: false, reason: "docx_active_content" });
  });

  it("accepts HYPERLINK, PAGE and NUMPAGES fields and printerSettings", async () => {
    const bytes = await makeDocx({
      document:
        '<w:document><w:instrText> HYPERLINK "https://example.com/hidden-gem" </w:instrText>' +
        "<w:instrText> PAGE </w:instrText><w:instrText> NUMPAGES </w:instrText></w:document>",
      extra: { "word/printerSettings/printerSettings1.bin": "x" },
    });
    expect((await inspectPublicDocument(bytes, "docx")).ok).toBe(true);
  });

  it("rejects bytes that are not a zip", async () => {
    const r = await inspectPublicDocument(enc("not a zip"), "docx");
    expect(r).toEqual({ ok: false, reason: "docx_active_content" });
  });

  it("rejects archives with too many entries", async () => {
    const extra: Record<string, string> = {};
    for (let i = 0; i < 501; i++) extra[`word/media/f${i}.txt`] = "x";
    const r = await inspectPublicDocument(await makeDocx({ extra }), "docx");
    expect(r).toEqual({ ok: false, reason: "docx_active_content" });
  });
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

  it("flattens transparency onto white", async () => {
    const png = await sharp({
      create: { width: 20, height: 20, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([
        { input: { create: { width: 4, height: 4, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }, left: 0, top: 0 },
      ])
      .png()
      .toBuffer();
    const r = await inspectPublicDocument(new Uint8Array(png), "png");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { data, info } = await sharp(Buffer.from(r.bytes)).raw().toBuffer({ resolveWithObject: true });
    const i = (15 * info.width + 15) * info.channels;
    expect(data[i]).toBeGreaterThan(240);
    expect(data[i + 1]).toBeGreaterThan(240);
    expect(data[i + 2]).toBeGreaterThan(240);
  });

  it("rejects bytes sharp cannot decode", async () => {
    const r = await inspectPublicDocument(new Uint8Array([0xff, 0xd8, 0xff, 0x00]), "jpeg");
    expect(r).toEqual({ ok: false, reason: "image_unreadable" });
  });
});
