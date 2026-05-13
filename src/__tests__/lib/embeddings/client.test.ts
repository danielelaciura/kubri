import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { generateEmbedding } from "@/lib/embeddings/client";
import { EmbeddingError } from "@/lib/embeddings/errors";

const ORIGINAL_FETCH = global.fetch;

describe("generateEmbedding", () => {
  beforeEach(() => {
    process.env["SUPABASE_EDGE_FUNCTION_URL"] = "https://example.supabase.co/functions/v1";
    process.env["SUPABASE_SERVICE_ROLE_KEY"] = "test-key";
    process.env["EMBEDDING_TIMEOUT_MS"] = "3000";
  });
  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    vi.restoreAllMocks();
  });

  it("returns the 384-dim vector on success", async () => {
    const fakeVector = Array.from({ length: 384 }, (_, i) => i / 1000);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: fakeVector }),
    }) as unknown as typeof fetch;

    const result = await generateEmbedding("hello world");
    expect(result).toHaveLength(384);
    expect(result[0]).toBe(0);
  });

  it("throws EmbeddingError on non-2xx", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "boom",
    }) as unknown as typeof fetch;

    await expect(generateEmbedding("x")).rejects.toBeInstanceOf(EmbeddingError);
  });

  it("throws EmbeddingError on malformed response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ unexpected: true }),
    }) as unknown as typeof fetch;

    await expect(generateEmbedding("x")).rejects.toBeInstanceOf(EmbeddingError);
  });

  it("throws EmbeddingError when vector length is wrong", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: [1, 2, 3] }),
    }) as unknown as typeof fetch;

    await expect(generateEmbedding("x")).rejects.toBeInstanceOf(EmbeddingError);
  });

  it("throws EmbeddingError when vector contains non-finite values", async () => {
    const bad = Array.from({ length: 384 }, () => 0.1);
    bad[10] = NaN;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: bad }),
    }) as unknown as typeof fetch;

    await expect(generateEmbedding("x")).rejects.toBeInstanceOf(EmbeddingError);
  });

  it("throws EmbeddingError when env is missing", async () => {
    delete process.env["SUPABASE_EDGE_FUNCTION_URL"];
    await expect(generateEmbedding("x")).rejects.toBeInstanceOf(EmbeddingError);
  });
});
