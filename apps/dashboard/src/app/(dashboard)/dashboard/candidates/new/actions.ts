"use server";

import { z } from "zod/v4";
import { revalidatePath } from "next/cache";
import { candidateFieldsSchema } from "@kubri/contracts";
import { toFieldErrors, type FieldErrors } from "@/lib/candidates/field-errors";
// Don't re-export types from this "use server" file (`export type { X }`):
// Turbopack's server-action transform treats them as runtime exports and
// crashes with "X is not defined". Import shared types from their own module.
import { requireOrganization } from "@/lib/auth-utils";
import { getOrgWritablePools } from "@/lib/pools/access";
import { logAudit } from "@/lib/audit";
import { createCandidateManually } from "@/lib/candidates/dashboard-create";
import {
  confirmImport,
  createUploadTicket,
  discardImport,
  getImportForOrg,
  registerUpload,
  runExtraction,
  type UploadTicket,
} from "@/lib/candidate-imports/service";
import {
  ImportError,
  ImportNotFoundError,
  ImportStateError,
  type ImportErrorCode,
} from "@/lib/candidate-imports/errors";

export type CreateCandidateErrorCode =
  | ImportErrorCode
  | "INVALID_POOL"
  | "VALIDATION"
  | "NOT_FOUND";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: CreateCandidateErrorCode; fieldErrors?: FieldErrors };

// All three roles may create candidates; every user reaching the dashboard
// has an organization, so requireOrganization is the role check.
async function session() {
  return requireOrganization();
}

async function writablePool(organizationId: string, poolId: string) {
  const pools = await getOrgWritablePools(organizationId);
  return pools.find((p) => p.id === poolId) ?? null;
}

// Errors can embed candidate data (LLM output, DB values): log name + message only.
function errorSummary(e: unknown) {
  return e instanceof Error ? { name: e.name, message: e.message } : { message: String(e) };
}

async function safeAudit(params: Parameters<typeof logAudit>[0]) {
  try {
    await logAudit(params);
  } catch (e) {
    console.error("[create candidate] audit log failed", errorSummary(e));
  }
}

function fail(e: unknown): { ok: false; error: CreateCandidateErrorCode } {
  if (e instanceof ImportError) return { ok: false, error: e.code };
  if (e instanceof ImportNotFoundError) return { ok: false, error: "NOT_FOUND" };
  console.error("[create candidate] unexpected error", errorSummary(e));
  return { ok: false, error: "INTERNAL_ERROR" };
}

function parseFields(values: unknown) {
  const parsed = candidateFieldsSchema.safeParse(values);
  if (parsed.success) return { ok: true as const, fields: parsed.data };
  const fieldErrors = toFieldErrors(parsed.error.issues);
  return { ok: false as const, fieldErrors };
}

const importIdSchema = z.string().uuid();

const uploadRequestSchema = z.object({
  poolId: z.string().min(1),
  fileName: z.string().min(1),
  fileSize: z.number().int().nonnegative(),
});

/**
 * Keep the tail (the extension survives). Applied identically in the request
 * and register steps because the storage path is derived from the name.
 */
const MAX_FILE_NAME_LENGTH = 255;
const clampFileName = (name: unknown) =>
  typeof name === "string" ? name.slice(-MAX_FILE_NAME_LENGTH) : name;

export async function requestCandidateUploadAction(
  input: z.input<typeof uploadRequestSchema>,
): Promise<ActionResult<UploadTicket>> {
  const user = await session();
  const parsed = uploadRequestSchema.safeParse({ ...input, fileName: clampFileName(input.fileName) });
  if (!parsed.success) return { ok: false, error: "VALIDATION" };
  // The upload screen has no fields to highlight: an empty file is a bad file.
  if (parsed.data.fileSize === 0) return { ok: false, error: "UNSUPPORTED_TYPE" };
  if (!(await writablePool(user.organizationId, parsed.data.poolId))) {
    return { ok: false, error: "INVALID_POOL" };
  }
  try {
    return { ok: true, data: await createUploadTicket(parsed.data) };
  } catch (e) {
    return fail(e);
  }
}

const registerSchema = z.object({
  importId: z.string().uuid(),
  poolId: z.string().min(1),
  fileName: z.string().min(1),
});

export async function registerCandidateUploadAction(
  input: z.input<typeof registerSchema>,
): Promise<ActionResult<{ importId: string }>> {
  const user = await session();
  const parsed = registerSchema.safeParse({ ...input, fileName: clampFileName(input.fileName) });
  if (!parsed.success) return { ok: false, error: "VALIDATION" };
  if (!(await writablePool(user.organizationId, parsed.data.poolId))) {
    return { ok: false, error: "INVALID_POOL" };
  }
  try {
    const { importId } = await registerUpload({
      ...parsed.data,
      organizationId: user.organizationId,
      origin: "OPERATOR",
      createdById: user.id,
    });
    await safeAudit({
      userId: user.id,
      organizationId: user.organizationId,
      action: "candidate_import.create",
      resourceType: "candidate_import",
      resourceId: importId,
      metadata: { poolId: parsed.data.poolId },
    });
    return { ok: true, data: { importId } };
  } catch (e) {
    return fail(e);
  }
}

export async function runCandidateImportExtractionAction(
  importId: string,
): Promise<ActionResult<null>> {
  const user = await session();
  const id = importIdSchema.safeParse(importId);
  if (!id.success) return { ok: false, error: "VALIDATION" };
  const imp = await getImportForOrg(id.data, user.organizationId);
  if (!imp) return { ok: false, error: "NOT_FOUND" };
  try {
    await runExtraction(imp.id);
  } catch (e) {
    return fail(e);
  }
  return { ok: true, data: null };
}

export async function confirmCandidateImportAction(
  importId: string,
  values: unknown,
): Promise<ActionResult<{ candidateId: string }>> {
  const user = await session();
  const id = importIdSchema.safeParse(importId);
  if (!id.success) return { ok: false, error: "VALIDATION" };
  const parsed = parseFields(values);
  if (!parsed.ok) return { ok: false, error: "VALIDATION", fieldErrors: parsed.fieldErrors };

  const imp = await getImportForOrg(id.data, user.organizationId);
  if (!imp) return { ok: false, error: "NOT_FOUND" };
  if (!(await writablePool(user.organizationId, imp.poolId))) {
    return { ok: false, error: "INVALID_POOL" };
  }

  try {
    const { candidateId } = await confirmImport({
      importId: imp.id,
      organizationId: user.organizationId,
      userId: user.id,
      fields: parsed.fields,
    });
    await safeAudit({
      userId: user.id,
      organizationId: user.organizationId,
      action: "candidate.create",
      resourceType: "candidate",
      resourceId: candidateId,
      metadata: { mode: "cv", importId: imp.id },
    });
    revalidatePath("/dashboard/candidates");
    return { ok: true, data: { candidateId } };
  } catch (e) {
    if (e instanceof ImportStateError) {
      // A concurrent confirm (double click, second tab) won the race.
      const current = await getImportForOrg(imp.id, user.organizationId);
      if (current?.status === "COMPLETED" && current.candidateId) {
        return { ok: true, data: { candidateId: current.candidateId } };
      }
      return { ok: false, error: "NOT_FOUND" };
    }
    return fail(e);
  }
}

export async function createCandidateManuallyAction(
  poolId: string,
  values: unknown,
): Promise<ActionResult<{ candidateId: string }>> {
  const user = await session();
  const pool = await writablePool(user.organizationId, poolId);
  if (!pool) return { ok: false, error: "INVALID_POOL" };
  const parsed = parseFields(values);
  if (!parsed.ok) return { ok: false, error: "VALIDATION", fieldErrors: parsed.fieldErrors };

  try {
    const { candidateId } = await createCandidateManually({
      pool,
      fields: parsed.fields,
      userId: user.id,
    });
    await safeAudit({
      userId: user.id,
      organizationId: user.organizationId,
      action: "candidate.create",
      resourceType: "candidate",
      resourceId: candidateId,
      metadata: { mode: "form", poolId },
    });
    revalidatePath("/dashboard/candidates");
    return { ok: true, data: { candidateId } };
  } catch (e) {
    return fail(e);
  }
}

export async function discardCandidateImportAction(importId: string): Promise<ActionResult<null>> {
  const user = await session();
  const id = importIdSchema.safeParse(importId);
  if (!id.success) return { ok: false, error: "VALIDATION" };
  const imp = await getImportForOrg(id.data, user.organizationId);
  if (!imp) return { ok: false, error: "NOT_FOUND" };
  const done = await discardImport(imp.id, user.organizationId);
  return done ? { ok: true, data: null } : { ok: false, error: "NOT_FOUND" };
}
