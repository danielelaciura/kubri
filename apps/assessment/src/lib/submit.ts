import type { AssessmentSubmission } from "@kubri/contracts";

export async function submitCommunity(payload: AssessmentSubmission): Promise<boolean> {
  const res = await fetch("/api/community", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.ok;
}
