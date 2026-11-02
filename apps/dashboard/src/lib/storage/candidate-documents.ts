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

/** Storage-safe file name: ASCII word chars, dot and dash only, up to 100 chars. */
export function sanitizeFileName(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w.-]+/g, "_")
    .replace(/_+/g, "_")
    // Leading dots would make hidden / traversal-like names ("..", ".env").
    .replace(/^\.+/, "");
  if (!cleaned || /^[._-]*$/.test(cleaned)) return "document";
  return cleaned.length > MAX_NAME_LENGTH ? cleaned.slice(-MAX_NAME_LENGTH) : cleaned;
}

export function buildDocumentPath(poolId: string, importId: string, fileName: string): string {
  return `${poolId}/${importId}/${sanitizeFileName(fileName)}`;
}

function bucket() {
  return createSupabaseAdminClient().storage.from(CANDIDATE_DOCUMENTS_BUCKET);
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

/** Overwrite an object in place (public uploads: re-encoded images). */
export async function replaceCandidateDocument(
  path: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  const { error } = await bucket().upload(path, bytes, { upsert: true, contentType });
  if (error) throw new StorageError(`replace failed: ${error.message}`);
}

export interface DocumentObject {
  /** Full object path: `poolId/importId/fileName`. */
  path: string;
  importId: string;
  createdAt: Date | null;
}

const LIST_PAGE_SIZE = 100;

interface ListedEntry {
  name: string;
  /** Null for folders. */
  id: string | null;
  created_at: string | null;
}

/** Every entry directly under `prefix`, following limit/offset pages. */
async function listAll(prefix: string): Promise<ListedEntry[]> {
  const entries: ListedEntry[] = [];
  for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
    const { data, error } = await bucket().list(prefix, { limit: LIST_PAGE_SIZE, offset });
    if (error || !data) throw new StorageError(`list failed: ${error?.message ?? "no data"}`);
    entries.push(...data);
    if (data.length < LIST_PAGE_SIZE) return entries;
  }
}

export interface ListDocumentObjectsOptions {
  /** Stop after listing the files of this many import folders. */
  maxImportFolders?: number;
  /** Epoch ms: stop listing once reached. */
  deadline?: number;
  /** Random source for the starting pool/import (tests inject it). */
  random?: () => number;
}

/** `xs` rotated to start at a random index. */
function rotate<T>(xs: T[], random: () => number): T[] {
  if (xs.length < 2) return xs;
  const k = Math.floor(random() * xs.length) % xs.length;
  return [...xs.slice(k), ...xs.slice(0, k)];
}

/**
 * Walk the bucket (`poolId/importId/file`) and return the stored files.
 * Used by the nightly orphan cleanup. One list call per import folder, so the
 * walk is bounded (`maxImportFolders`, `deadline`) and starts at a random pool
 * and import: successive capped runs cover different parts of the bucket.
 */
export async function listDocumentObjects(opts: ListDocumentObjectsOptions = {}): Promise<DocumentObject[]> {
  const maxFolders = opts.maxImportFolders ?? Number.POSITIVE_INFINITY;
  const deadline = opts.deadline ?? Number.POSITIVE_INFINITY;
  const random = opts.random ?? Math.random;
  let visited = 0;
  const exhausted = () => visited >= maxFolders || Date.now() >= deadline;

  const objects: DocumentObject[] = [];
  if (exhausted()) return objects;
  const pools = rotate((await listAll("")).filter((e) => e.id === null), random);
  for (const pool of pools) {
    if (exhausted()) break;
    const imports = rotate((await listAll(pool.name)).filter((e) => e.id === null), random);
    for (const imp of imports) {
      if (exhausted()) break;
      visited++;
      const files = await listAll(`${pool.name}/${imp.name}`);
      for (const f of files) {
        // Folders and Supabase's ".emptyFolderPlaceholder" (sanitized uploads never start with ".").
        if (f.id === null || f.name.startsWith(".")) continue;
        objects.push({
          path: `${pool.name}/${imp.name}/${f.name}`,
          importId: imp.name,
          createdAt: f.created_at ? new Date(f.created_at) : null,
        });
      }
    }
  }
  return objects;
}
