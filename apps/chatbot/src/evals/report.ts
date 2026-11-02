import { z } from "zod";

/**
 * The part of a report that comparison and gates read. A baseline is parsed with this schema,
 * so older reports with extra fields keep working (D97).
 */
const ReportViewSchema = z.object({
  version: z.literal(1),
  meta: z.object({
    suite: z.string(),
    createdAt: z.string(),
    promptVersion: z.string(),
    datasetHash: z.string(),
  }),
  metrics: z.object({
    passRate: z.number(),
    hallucination: z.object({ rate: z.number().nullable() }),
    intent: z.object({ accuracy: z.number().nullable() }),
    byLanguage: z.record(z.string(), z.object({ passRate: z.number(), cases: z.number() })),
  }),
  cases: z.array(z.object({ id: z.string(), pass: z.boolean() })),
});
export type ReportView = z.infer<typeof ReportViewSchema>;

export function parseReport(text: string): ReportView {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("the report is not valid JSON");
  }
  const parsed = ReportViewSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `not an eval report: ${issue?.path.map(String).join(".") ?? ""}: ${issue?.message ?? ""}`,
    );
  }
  return parsed.data;
}
