// Supabase Edge Function — Mistral embeddings (mistral-embed, 1024-dim, EU)
// deno-lint-ignore-file no-explicit-any
declare const Deno: any;

const MISTRAL_API_KEY = Deno.env.get("MISTRAL_API_KEY") ?? "";
const MISTRAL_URL = "https://api.mistral.ai/v1/embeddings";

function isServiceRole(authHeader: string | null): boolean {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return false;
  const token = authHeader.slice("Bearer ".length);
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  try {
    const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(payloadB64));
    return payload.role === "service_role";
  } catch {
    return false;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { "content-type": "application/json" },
    });
  }
  if (!isServiceRole(req.headers.get("authorization"))) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  if (!MISTRAL_API_KEY) {
    return new Response(JSON.stringify({ error: "mistral_api_key_missing" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  let body: { text?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  if (typeof body.text !== "string" || body.text.length === 0) {
    return new Response(JSON.stringify({ error: "text_required" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const upstream = await fetch(MISTRAL_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${MISTRAL_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: "mistral-embed", input: [body.text] }),
  });

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    return new Response(
      JSON.stringify({ error: "mistral_upstream_error", status: upstream.status, detail }),
      { status: 502, headers: { "content-type": "application/json" } },
    );
  }

  let data: any;
  try {
    data = await upstream.json();
  } catch {
    return new Response(JSON.stringify({ error: "mistral_invalid_json" }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }

  const embedding = data?.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length === 0) {
    return new Response(JSON.stringify({ error: "mistral_no_embedding", raw: data }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ embedding }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});
