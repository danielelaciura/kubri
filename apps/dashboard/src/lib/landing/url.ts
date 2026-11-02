import { getAppOrigin } from "@/lib/origin";

/** Canonical public URL of a landing: NEXT_PUBLIC_APP_URL when set, else the request origin. Server-only. */
export async function landingPublicUrl(slug: string): Promise<string> {
  const configured = process.env["NEXT_PUBLIC_APP_URL"]?.trim().replace(/\/+$/, "");
  const origin = configured ? configured : await getAppOrigin();
  return `${origin}/candidati/${slug}`;
}
