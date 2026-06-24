import { EmbeddingError } from "./errors";

const EMBEDDING_DIM = 1024;

export async function generateEmbedding(text: string): Promise<number[]> {
  const url = process.env["SUPABASE_EDGE_FUNCTION_URL"];
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) {
    throw new EmbeddingError("Embedding service env vars missing");
  }
  // Default tuned for Supabase Edge Function cold starts (~1–2s) plus generation.
  const timeoutMs = Number(process.env["EMBEDDING_TIMEOUT_MS"] ?? "10000");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${url}/embed`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });
  } catch (e) {
    throw new EmbeddingError("Embedding request failed", e);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new EmbeddingError(`Embedding HTTP ${res.status}: ${body}`);
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch (e) {
    throw new EmbeddingError("Embedding response is not JSON", e);
  }

  if (
    typeof data !== "object" ||
    data === null ||
    !Array.isArray((data as { embedding?: unknown }).embedding)
  ) {
    throw new EmbeddingError("Embedding response missing 'embedding' array");
  }

  const vector = (data as { embedding: number[] }).embedding;
  if (vector.length !== EMBEDDING_DIM) {
    throw new EmbeddingError(
      `Embedding has wrong dim: expected ${EMBEDDING_DIM}, got ${vector.length}`,
    );
  }
  if (!vector.every((n) => typeof n === "number" && Number.isFinite(n))) {
    throw new EmbeddingError("Embedding contains non-finite numbers");
  }
  return vector;
}

export function vectorToPgLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}
