import { assessmentReportSchema, type AssessmentReport } from "@kubri/contracts";
import { extractStructured } from "@/lib/llm/structured";
import { buildReportPrompt } from "./prompt";

export class ReportGenerationError extends Error {}

/**
 * Build the prompt, call Mistral, and validate against the report schema.
 * `extractStructured` retries once (transport error or schema-invalid output).
 * Throws ReportGenerationError if both attempts fail.
 */
export async function generateReport(answers: Record<string, unknown>): Promise<AssessmentReport> {
  const { system, user } = buildReportPrompt(answers);
  try {
    return await extractStructured({
      schema: assessmentReportSchema,
      system,
      user,
      temperature: 0.3,
      timeoutMs: Number(process.env["MISTRAL_TIMEOUT_MS"] ?? "20000"),
    });
  } catch (e) {
    throw new ReportGenerationError(`report generation failed: ${String(e)}`);
  }
}
