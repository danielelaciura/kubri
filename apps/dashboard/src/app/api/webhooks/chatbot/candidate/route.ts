import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { chatbotCandidateWebhookSchema } from "@kubri/contracts";
import { prisma } from "@/lib/db";
import { ingestCandidate } from "@/lib/candidates/ingest";
import { locateChatbotCandidate } from "@/lib/chatbot/locate";
import { normalizeChatbotCandidate } from "@/lib/chatbot/normalize";
import { resolvePoolByExternalKey, UnknownPoolError } from "@/lib/pools/resolve";

const LOG_TAG = "webhook chatbot/candidate";

/** Constant-time check of `Authorization: Bearer <CHATBOT_WEBHOOK_SECRET>`. No secret, no entry. */
function authorized(header: string | null): boolean {
  const secret = process.env["CHATBOT_WEBHOOK_SECRET"]?.trim();
  if (!secret || !header) return false;
  // Hashing first gives equal lengths, so the comparison leaks neither content nor length.
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}

function errorName(e: unknown): string {
  return e instanceof Error ? e.name : "unknown";
}

/**
 * The Kubri chatbot sends the candidate's full, current profile here (contract in
 * `@kubri/contracts`). The dashboard geocodes it, drops sends older than the stored profile
 * and writes through `ingestCandidate`. Never log values: they are personal data.
 */
export async function POST(req: Request): Promise<Response> {
  if (!authorized(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = chatbotCandidateWebhookSchema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path.join("."), code: i.code }));
    console.error(`[${LOG_TAG}] validation failed`, { issues });
    return NextResponse.json({ error: "validation_failed", issues }, { status: 400 });
  }
  const payload = parsed.data;

  let pool;
  try {
    pool = await resolvePoolByExternalKey(payload.externalKey);
  } catch (e) {
    if (e instanceof UnknownPoolError) {
      console.error(`[${LOG_TAG}] unknown pool`, { externalKey: e.externalKey });
      return NextResponse.json({ error: "unknown_pool", externalKey: e.externalKey }, { status: 422 });
    }
    console.error(`[${LOG_TAG}] pool lookup failed`, { error: errorName(e) });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  try {
    const existing = await prisma.candidate.findUnique({
      where: { poolId_externalId: { poolId: pool.id, externalId: payload.key } },
      select: { sourceUpdatedAt: true, location: true, latitude: true, longitude: true, rawPayload: true },
    });

    // Sends can arrive out of order: never overwrite a newer profile with an older one.
    const sentAt = new Date(payload.data.last_updated);
    if (existing?.sourceUpdatedAt && existing.sourceUpdatedAt.getTime() > sentAt.getTime()) {
      return NextResponse.json({ ok: true, skipped: "stale" });
    }

    const geo = await locateChatbotCandidate(payload.data, existing);
    const { candidateId } = await ingestCandidate(normalizeChatbotCandidate(payload, pool, geo), LOG_TAG);
    return NextResponse.json({ ok: true, candidateId });
  } catch (e) {
    console.error(`[${LOG_TAG}] upsert failed`, { error: errorName(e) });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
