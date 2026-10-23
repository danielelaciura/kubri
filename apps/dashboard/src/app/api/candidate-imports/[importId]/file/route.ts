import { NextResponse } from "next/server";
import { requireOrganization } from "@/lib/auth-utils";
import { getImportForOrg } from "@/lib/candidate-imports/service";
import { createDocumentSignedUrl } from "@/lib/storage/candidate-documents";

/** Inline preview of an import's file for the review page (org-scoped). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ importId: string }> },
) {
  let user;
  try {
    user = await requireOrganization();
  } catch {
    return new Response(null, { status: 401 });
  }
  const { importId } = await params;
  const imp = await getImportForOrg(importId, user.organizationId);
  if (!imp || imp.status === "DISCARDED") return new Response(null, { status: 404 });

  let url: string;
  try {
    url = await createDocumentSignedUrl(imp.storagePath);
  } catch (e) {
    console.error("[candidate file] signed url failed", e instanceof Error ? e.message : String(e));
    return new Response(null, { status: 502 });
  }
  return NextResponse.redirect(url, 307);
}
