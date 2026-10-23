import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { StorageError } from "./errors";

export { StorageError };

/**
 * Private bucket holding candidate CVs. Accessed only server-side with the
 * service role; viewers get short-lived signed URLs. Must exist in every
 * Supabase project (created manually, private, no public access).
 */
export const CANDIDATE_DOCUMENTS_BUCKET = "candidate-documents";

const MAX_NAME_LENGTH = 100;

/** Storage-safe file name: ASCII word chars, dot and dash only, ≤100 chars. */
export function sanitizeFileName(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w.-]+/g, "_")
    .replace(/_+/g, "_");
  if (!cleaned) return "document";
  return cleaned.length > MAX_NAME_LENGTH ? cleaned.slice(-MAX_NAME_LENGTH) : cleaned;
}

export function buildDocumentPath(poolId: string, importId: string, fileName: string): string {
  return `${poolId}/${importId}/${sanitizeFileName(fileName)}`;
}

function bucket() {
  return createSupabaseAdminClient().storage.from(CANDIDATE_DOCUMENTS_BUCKET);
}

export async function uploadCandidateDocument(
  path: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  const { error } = await bucket().upload(path, bytes, { contentType, upsert: false });
  if (error) throw new StorageError(`upload failed: ${error.message}`);
}

/**
 * Signed upload token for one exact path: the browser uploads the file
 * straight to Storage (bypassing Vercel's 4.5 MB request-body cap) with
 * `supabase.storage.from(bucket).uploadToSignedUrl(path, token, file)`.
 */
export async function createDocumentUploadUrl(path: string): Promise<{ token: string }> {
  const { data, error } = await bucket().createSignedUploadUrl(path);
  if (error || !data) throw new StorageError(`signed upload url failed: ${error?.message ?? "no data"}`);
  return { token: data.token };
}

export async function downloadCandidateDocument(path: string): Promise<Uint8Array> {
  const { data, error } = await bucket().download(path);
  if (error || !data) throw new StorageError(`download failed: ${error?.message ?? "no data"}`);
  return new Uint8Array(await data.arrayBuffer());
}

export async function createDocumentSignedUrl(
  path: string,
  opts: { expiresIn?: number; downloadAs?: string } = {},
): Promise<string> {
  const { data, error } = await bucket().createSignedUrl(
    path,
    opts.expiresIn ?? 60,
    opts.downloadAs ? { download: opts.downloadAs } : undefined,
  );
  if (error || !data) throw new StorageError(`signed url failed: ${error?.message ?? "no data"}`);
  return data.signedUrl;
}

export async function removeCandidateDocuments(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await bucket().remove(paths);
  if (error) throw new StorageError(`remove failed: ${error.message}`);
}
