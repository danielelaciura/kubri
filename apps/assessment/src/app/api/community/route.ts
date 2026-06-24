import { NextResponse } from "next/server";
import { assessmentSubmissionSchema } from "@kubri/contracts";

export async function POST(req: Request): Promise<Response> {
  const webhookUrl = process.env["DASHBOARD_WEBHOOK_URL"];
  const secret = process.env["ASSESSMENT_WEBHOOK_SECRET"];
  if (!webhookUrl || !secret) {
    console.error("[assessment/community] missing webhook config");
    return NextResponse.json({ error: "misconfigured" }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = assessmentSubmissionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(parsed.data),
    });
  } catch (e) {
    console.error("[assessment/community] upstream fetch failed", e);
    return NextResponse.json({ error: "upstream_unreachable" }, { status: 502 });
  }

  if (!upstream.ok) {
    console.error("[assessment/community] upstream error", upstream.status);
    return NextResponse.json({ error: "upstream_error" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
