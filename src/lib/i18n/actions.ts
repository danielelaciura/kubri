"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/db";
import { languageSchema } from "@/lib/validations/language";
import { getDictionary } from "@/lib/i18n";
import { getServerLocale } from "@/lib/i18n/locale";

export async function setLanguage(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  const t = getDictionary(await getServerLocale());

  const parsed = languageSchema.safeParse({
    language: formData.get("language"),
  });
  if (!parsed.success) {
    throw new Error(t.common.invalidLanguage);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { language: parsed.data.language },
  });

  revalidatePath("/");
}
