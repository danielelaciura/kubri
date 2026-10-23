import { LLMError, LLMTimeoutError } from "@/lib/llm/errors";

const OCR_URL = "https://api.mistral.ai/v1/ocr";
const OCR_MODEL = "mistral-ocr-latest";
const DEFAULT_TIMEOUT_MS = 20000;
/** A CV rarely needs more; keeps long scans inside the request budget. */
const MAX_OCR_PAGES = 10;

interface OcrResponse {
  pages?: unknown;
}

/**
 * OCR a PDF or image with Mistral OCR (EU-hosted, same processor as our chat
 * calls). The file is sent inline as a base64 data URI — nothing is uploaded
 * to Mistral's file store. Returns the pages' markdown joined by blank lines.
 */
export async function ocrDocument(
  bytes: Uint8Array,
  mimeType: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<{ text: string; pageCount: number }> {
  const apiKey = process.env["MISTRAL_API_KEY"];
  if (!apiKey) throw new LLMError("MISTRAL_API_KEY is not set");

  const dataUri = `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
  const document = mimeType.startsWith("image/")
    ? { type: "image_url", image_url: dataUri }
    : { type: "document_url", document_url: dataUri };

  const isPdf = !mimeType.startsWith("image/");
  const payload: Record<string, unknown> = { model: OCR_MODEL, document };
  if (isPdf) payload["pages"] = Array.from({ length: MAX_OCR_PAGES }, (_, i) => i);

  // The timer covers the whole exchange, including reading the response body.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let data: unknown;
  try {
    const res = await fetch(OCR_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new LLMError(`Mistral OCR HTTP ${res.status}: ${body.slice(0, 500)}`);
    }
    try {
      data = await res.json();
    } catch (e) {
      if (controller.signal.aborted) throw e;
      throw new LLMError("Mistral OCR response is not JSON", e);
    }
  } catch (e) {
    if (e instanceof LLMError) throw e;
    if (controller.signal.aborted) throw new LLMTimeoutError("Mistral OCR timed out", e);
    throw new LLMError("Mistral OCR request failed", e);
  } finally {
    clearTimeout(timer);
  }

  if (typeof data !== "object" || data === null) {
    throw new LLMError("Mistral OCR response has no pages");
  }
  const rawPages = (data as OcrResponse).pages;
  const pages = Array.isArray(rawPages) ? rawPages : [];
  const text = pages
    .map((p) =>
      typeof p === "object" &&
      p !== null &&
      typeof (p as { markdown?: unknown }).markdown === "string"
        ? ((p as { markdown: string }).markdown).trim()
        : "",
    )
    .filter((s) => s.length > 0)
    .join("\n\n");
  return { text, pageCount: pages.length };
}
