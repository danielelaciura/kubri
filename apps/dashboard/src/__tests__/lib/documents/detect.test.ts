import { describe, it, expect } from "vitest";
import { detectDocumentKind, DOCUMENT_MIME } from "@/lib/documents/detect";

const bytes = (...b: number[]) => new Uint8Array(b);
const ascii = (s: string) => new TextEncoder().encode(s);

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

describe("detectDocumentKind", () => {
  it("detects PDF", () => {
    expect(detectDocumentKind(ascii("%PDF-1.7\n..."))).toBe("pdf");
  });
  it("detects JPEG", () => {
    expect(detectDocumentKind(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0))).toBe("jpeg");
  });
  it("detects PNG", () => {
    expect(detectDocumentKind(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe("png");
  });
  it("detects DOCX (zip containing word/)", () => {
    const zip = concat(bytes(0x50, 0x4b, 0x03, 0x04), ascii("....[Content_Types].xml....word/document.xml"));
    expect(detectDocumentKind(zip)).toBe("docx");
  });
  it("rejects a non-Word zip", () => {
    const zip = concat(bytes(0x50, 0x4b, 0x03, 0x04), ascii("....xl/workbook.xml"));
    expect(detectDocumentKind(zip)).toBeNull();
  });
  it("rejects legacy .doc (OLE) and unknown bytes", () => {
    expect(detectDocumentKind(bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1))).toBeNull();
    expect(detectDocumentKind(ascii("hello"))).toBeNull();
  });
  it("maps kinds to MIME types", () => {
    expect(DOCUMENT_MIME.pdf).toBe("application/pdf");
    expect(DOCUMENT_MIME.docx).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
  });
});
