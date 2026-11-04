import { getLandingLogoPath } from "@/lib/landing/service";
import { downloadCandidateDocument } from "@/lib/storage/candidate-documents";

/**
 * The partner logo of an enabled landing. Public like the page itself; the
 * file stays in the private bucket and only this exact object is exposed.
 * The page links it with ?v=<updatedAt>, so it can be cached for long.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const path = await getLandingLogoPath(slug);
  if (!path) return new Response(null, { status: 404 });
  try {
    const bytes = await downloadCandidateDocument(path);
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    console.error("[landing logo] download failed", e);
    return new Response(null, { status: 404 });
  }
}
