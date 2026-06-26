import { NextResponse } from "next/server";

export async function POST(req: Request): Promise<Response> {
  const reportUrl = process.env["DASHBOARD_REPORT_URL"];
  const secret = process.env["ASSESSMENT_WEBHOOK_SECRET"];
  if (!reportUrl || !secret) {
    console.error("[assessment/report] missing config");
    return NextResponse.json({ error: "misconfigured" }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(reportUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.error("[assessment/report] upstream fetch failed", e);
    return NextResponse.json({ error: "upstream_unreachable" }, { status: 502 });
  }

  if (!upstream.ok) {
    console.error("[assessment/report] upstream error", upstream.status);
    return NextResponse.json({ error: "upstream_error" }, { status: 502 });
  }

  const buf = await upstream.arrayBuffer();
  return new Response(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition":
        upstream.headers.get("content-disposition") ??
        'attachment; filename="competenze-kubri.pdf"',
    },
  });
}
