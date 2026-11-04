import sharp from "sharp";
import { detectDocumentKind } from "@/lib/documents/detect";
import { removeCandidateDocuments, replaceCandidateDocument } from "@/lib/storage/candidate-documents";

/** Upload cap; server actions accept ~1 MB bodies, a logo needs far less. */
export const LANDING_LOGO_MAX_BYTES = 500 * 1024;
/** Stored size: the page shows it at 44px, so 256px covers high-DPI screens. */
const LOGO_SIDE = 256;
const LOGO_TIMEOUT_SECONDS = 5;

export type LogoError = "LOGO_TOO_LARGE" | "LOGO_UNSUPPORTED";

/**
 * Lives in the private candidate-documents bucket (service role only) and is
 * served by /candidati/<slug>/logo, so no public bucket is needed.
 */
export function landingLogoPath(organizationId: string): string {
  return `landing-logos/${organizationId}.png`;
}

/**
 * PNG or JPEG in, a re-encoded square-bounded PNG out (transparency kept,
 * metadata dropped). Magic bytes decide the type, never the file name.
 */
export async function processLandingLogo(
  bytes: Uint8Array,
): Promise<{ ok: true; png: Uint8Array } | { ok: false; error: LogoError }> {
  if (bytes.byteLength > LANDING_LOGO_MAX_BYTES) return { ok: false, error: "LOGO_TOO_LARGE" };
  const kind = detectDocumentKind(bytes);
  if (kind !== "png" && kind !== "jpeg") return { ok: false, error: "LOGO_UNSUPPORTED" };
  try {
    const png = await sharp(bytes, { limitInputPixels: 25_000_000, failOn: "error" })
      .timeout({ seconds: LOGO_TIMEOUT_SECONDS })
      .rotate()
      .resize({ width: LOGO_SIDE, height: LOGO_SIDE, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
    return { ok: true, png: new Uint8Array(png) };
  } catch {
    return { ok: false, error: "LOGO_UNSUPPORTED" };
  }
}

export async function storeLandingLogo(organizationId: string, png: Uint8Array): Promise<string> {
  const path = landingLogoPath(organizationId);
  await replaceCandidateDocument(path, png, "image/png");
  return path;
}

export async function removeLandingLogo(organizationId: string): Promise<void> {
  await removeCandidateDocuments([landingLogoPath(organizationId)]);
}
