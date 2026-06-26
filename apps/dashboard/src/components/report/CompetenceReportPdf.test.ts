import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { renderCompetenceReportPdf } from "./CompetenceReportPdf";
import type { AssessmentReport } from "@kubri/contracts";

const REPORT: AssessmentReport = {
  intro: "Profilo pratico e orientato alle persone.",
  domains: [
    { id: "technical", competences: [{ name: "Lavoro manuale", level: "Forte", note: "Punto di forza" }] },
    { id: "relational", competences: [{ name: "Cura del cliente", level: "Buono", note: "Da esperienza" }] },
  ],
};

describe("renderCompetenceReportPdf", () => {
  it("renders to a non-empty PDF buffer (with a name)", async () => {
    const buf = await renderToBuffer(renderCompetenceReportPdf({ report: REPORT, name: "Mario Rossi" }));
    expect(buf.length).toBeGreaterThan(1000);
  });

  it("renders without a name", async () => {
    const buf = await renderToBuffer(renderCompetenceReportPdf({ report: REPORT }));
    expect(buf.length).toBeGreaterThan(1000);
  });
});
