// Supabase Edge Function — runs gte-small via Supabase.ai
// deno-lint-ignore-file no-explicit-any
declare const Deno: any;
const Supabase: any = (globalThis as any).Supabase;

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

  const session = new Supabase.ai.Session("gte-small");
  const embedding = await session.run(body.text, {
    mean_pool: true,
    normalize: true,
  });

  return new Response(JSON.stringify({ embedding }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});
