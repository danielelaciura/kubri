import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { renderToBuffer } from "@react-pdf/renderer";
import { generateReport } from "@/lib/report/generate";
import { renderCompetenceReportPdf } from "@/components/report/CompetenceReportPdf";

// Needs the Node runtime (node:path, font file read, renderToBuffer). The
// Mistral call (up to ~20s) plus one retry plus PDF render can exceed the
// platform's default function timeout, so raise it.
export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  assessment: z.record(z.string(), z.unknown()),
  name: z.string().optional(),
});

export async function POST(req: Request): Promise<Response> {
  const expected = process.env["ASSESSMENT_WEBHOOK_SECRET"];
  if (!expected || req.headers.get("authorization") !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }

  // name is used only for the PDF header — never passed to the LLM.
  const { assessment, name } = parsed.data;

  let report;
  try {
    report = await generateReport(assessment);
  } catch (e) {
    console.error("[assessment/report] generation failed", e);
    return NextResponse.json({ error: "report_generation_failed" }, { status: 502 });
  }

  let buffer: Buffer;
  try {
    buffer = await renderToBuffer(renderCompetenceReportPdf({ report, name }));
  } catch (e) {
    console.error("[assessment/report] pdf render failed", e);
    return NextResponse.json({ error: "report_render_failed" }, { status: 502 });
  }
  const safeName = (name ?? "kubri").replace(/[^a-zA-Z0-9À-ɏ\s-]/g, "").replace(/\s+/g, "-").toLowerCase() || "kubri";

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="competenze-${safeName}.pdf"`,
    },
  });
}
