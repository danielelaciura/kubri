"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/db";
import { languageSchema } from "@/lib/validations/language";

export async function setLanguage(formData: FormData): Promise<void> {
  const user = await getCurrentUser();

  const parsed = languageSchema.safeParse({
    language: formData.get("language"),
  });
  if (!parsed.success) {
    throw new Error("Lingua non valida");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { language: parsed.data.language },
  });

  revalidatePath("/");
}
