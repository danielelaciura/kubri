import { assessmentReportSchema, type AssessmentReport } from "@kubri/contracts";
import { callMistralJson } from "@/lib/llm/mistral";
import { buildReportPrompt } from "./prompt";

export class ReportGenerationError extends Error {}

/**
 * Build the prompt, call Mistral, and validate against the report schema.
 * Retries once on any failure (transport or schema-invalid). Throws
 * ReportGenerationError if both attempts fail.
 */
export async function generateReport(answers: Record<string, unknown>): Promise<AssessmentReport> {
  const { system, user } = buildReportPrompt(answers);

  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await callMistralJson(system, user);
      const parsed = assessmentReportSchema.safeParse(raw);
      if (parsed.success) return parsed.data;
      lastErr = new ReportGenerationError("schema validation failed");
    } catch (e) {
      lastErr = e;
    }
  }
  throw new ReportGenerationError(`report generation failed: ${String(lastErr)}`);
}
