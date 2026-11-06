import PDFDocument from "pdfkit";
import type { CvLayout } from "./layout";

/**
 * The standard PDF fonts draw WinAnsi (Latin-1 plus a few signs). Anything else would make
 * pdfkit throw or draw garbage, so it becomes "?" (D127: a known limit for non-Latin names).
 */
const EXTRA = new Set(["€", "–", "—", "‘", "’", "“", "”", "•", "…"]);

export function toWinAnsi(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20) continue;
    out += code <= 0xff || EXTRA.has(char) ? char : "?";
  }
  return out;
}

const MARGIN = 56;

/** Draws the layout on A4, one column. The look of the template lives here only. */
export function renderCv(layout: CvLayout): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: MARGIN,
      info: { Title: toWinAnsi(layout.title) },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => {
      resolve(new Uint8Array(Buffer.concat(chunks)));
    });
    doc.on("error", reject);

    doc.font("Helvetica-Bold").fontSize(24).text(toWinAnsi(layout.title));
    if (layout.contacts.length > 0) {
      doc
        .moveDown(0.3)
        .font("Helvetica")
        .fontSize(10)
        .fillColor("#555555")
        .text(toWinAnsi(layout.contacts.join("  ·  ")));
    }
    for (const { heading, lines } of layout.sections) {
      doc
        .moveDown(1)
        .fillColor("#000000")
        .font("Helvetica-Bold")
        .fontSize(13)
        .text(toWinAnsi(heading.toUpperCase()));
      doc
        .moveTo(MARGIN, doc.y + 2)
        .lineTo(doc.page.width - MARGIN, doc.y + 2)
        .strokeColor("#cccccc")
        .stroke();
      doc.moveDown(0.5).font("Helvetica").fontSize(11);
      for (const line of lines) doc.text(toWinAnsi(line), { paragraphGap: 3 });
    }
    doc.end();
  });
}
