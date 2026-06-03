import { NextResponse } from "next/server";
import { getDueRecipients } from "@/lib/notifications/select-recipients";
import { getNewCandidatesForUser } from "@/lib/notifications/new-candidates";
import { sendDigest } from "@/lib/notifications/send-digest";

export async function GET(req: Request): Promise<Response> {
  const expected = process.env["CRON_SECRET"];
  const auth = req.headers.get("authorization");
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const recipients = await getDueRecipients(now);

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const user of recipients) {
    try {
      const breakdown = await getNewCandidatesForUser(user);
      const total = breakdown.reduce((s, b) => s + b.count, 0);
      if (total === 0) {
        skipped++;
        continue;
      }
      await sendDigest(user, user.organizationName, breakdown);
      sent++;
    } catch (e) {
      console.error("[cron] notification digest failed for user", user.id, e);
      failed++;
    }
  }

  return NextResponse.json({ sent, skipped, failed });
}
