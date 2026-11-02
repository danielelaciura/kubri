import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ocrDocument } from "@/lib/documents/ocr";
import { LLMError } from "@/lib/llm/errors";

const fetchMock = vi.fn();

describe("ocrDocument", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    process.env["MISTRAL_API_KEY"] = "k";
  });
  afterEach(() => vi.unstubAllGlobals());

  it("sends a PDF as document_url data URI and joins page markdown", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ pages: [{ markdown: "Pagina 1" }, { markdown: "Pagina 2" }] })),
    );
    const r = await ocrDocument(new Uint8Array([1, 2, 3]), "application/pdf");
    expect(r).toEqual({ text: "Pagina 1\n\nPagina 2", pageCount: 2 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.mistral.ai/v1/ocr");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("mistral-ocr-latest");
    expect(body.document).toEqual({
      type: "document_url",
      document_url: "data:application/pdf;base64,AQID",
    });
  });

  it("sends images as image_url", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ pages: [{ markdown: "x" }] })));
    await ocrDocument(new Uint8Array([1]), "image/png");
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.document.type).toBe("image_url");
    expect(body.document.image_url).toMatch(/^data:image\/png;base64,/);
  });

  it("throws LLMError on HTTP errors", async () => {
    fetchMock.mockResolvedValueOnce(new Response("bad", { status: 500 }));
    await expect(ocrDocument(new Uint8Array([1]), "image/png")).rejects.toBeInstanceOf(LLMError);
  });

  it("throws LLMError when the API key is missing", async () => {
    delete process.env["MISTRAL_API_KEY"];
    await expect(ocrDocument(new Uint8Array([1]), "image/png")).rejects.toBeInstanceOf(LLMError);
  });

  it("throws LLMError on a null JSON body", async () => {
    fetchMock.mockResolvedValueOnce(new Response("null"));
    await expect(ocrDocument(new Uint8Array([1]), "image/png")).rejects.toBeInstanceOf(LLMError);
  });

  it("skips non-object page entries", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ pages: [null, { markdown: "ok" }, 3] })),
    );
    const r = await ocrDocument(new Uint8Array([1]), "image/png");
    expect(r.text).toBe("ok");
  });

  it("limits PDFs to the first 10 pages and sends no pages for images", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ pages: [] })));
    await ocrDocument(new Uint8Array([1]), "application/pdf");
    const pdfBody = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(pdfBody.pages).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ pages: [] })));
    await ocrDocument(new Uint8Array([1]), "image/png");
    const imgBody = JSON.parse(fetchMock.mock.calls[1]![1].body);
    expect(imgBody.pages).toBeUndefined();
  });

  it("requests only the first maxPages pages of a PDF", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ pages: [{ markdown: "testo" }] })));
    await ocrDocument(new Uint8Array([1, 2, 3]), "application/pdf", 20000, 3);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string) as { pages: number[] };
    expect(body.pages).toEqual([0, 1, 2]);
  });
});
