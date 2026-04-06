import { z } from "zod/v4";

export const createOrgSchema = z.object({
  name: z.string().min(1, "Nome obbligatorio"),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "Solo lettere minuscole, numeri e trattini"),
  makeDatastoreId: z.string().min(1, "Data Store ID obbligatorio"),
  makeApiToken: z.string().min(1, "API Token obbligatorio"),
  adminEmail: z.email("Email non valida"),
  adminName: z.string().min(1, "Nome obbligatorio"),
  adminPassword: z
    .string()
    .min(8, "La password deve avere almeno 8 caratteri"),
});

export const inviteMemberSchema = z.object({
  email: z.email("Email non valida"),
  name: z.string().min(1, "Nome obbligatorio"),
  role: z.enum(["ORG_ADMIN", "ORG_MEMBER"]),
  temporaryPassword: z
    .string()
    .min(8, "La password deve avere almeno 8 caratteri"),
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
