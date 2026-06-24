import { z } from "zod/v4";

export const createOrgSchema = z.object({
  name: z.string().min(1, "Nome obbligatorio"),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "Solo lettere minuscole, numeri e trattini"),
  // No admin user is created here — members are invited afterwards from the
  // org detail page (admin/organizations/[id]).
});

export const inviteMemberSchema = z.object({
  email: z.email("Email non valida"),
  name: z.string().min(1, "Nome obbligatorio"),
  role: z.enum(["ORG_ADMIN", "ORG_MEMBER"]),
  // temporaryPassword removed
});

export const updateOrgSettingsSchema = z.object({
  name: z.string().min(1).optional(),
});

export const changeRoleSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(["ORG_ADMIN", "ORG_MEMBER"]),
});

export const removeMemberSchema = z.object({
  userId: z.string().min(1),
});

export const resendInviteSchema = z.object({
  userId: z.string().min(1),
});
