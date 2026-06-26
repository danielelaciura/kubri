const MISTRAL_URL = "https://api.mistral.ai/v1/chat/completions";
const MODEL = "mistral-small-latest";

export class MistralError extends Error {}

/**
 * Call Mistral in JSON mode and return the parsed JSON content (unknown — the
 * caller validates it). Throws MistralError on transport/HTTP/parse failure.
 */
export async function callMistralJson(system: string, user: string): Promise<unknown> {
  const key = process.env["MISTRAL_API_KEY"];
  if (!key) throw new MistralError("MISTRAL_API_KEY missing");

  const timeoutMs = Number(process.env["MISTRAL_TIMEOUT_MS"] ?? "20000");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(MISTRAL_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
      }),
      signal: controller.signal,
    });
  } catch {
    throw new MistralError("Mistral request failed");
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new MistralError(`Mistral HTTP ${res.status}`);

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new MistralError("Mistral response not JSON");
  }
  const content = (body as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new MistralError("Mistral response missing content");

  try {
    return JSON.parse(content);
  } catch {
    throw new MistralError("Mistral content not parseable JSON");
  }
}
