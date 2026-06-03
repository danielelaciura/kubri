import { z } from "zod/v4";

export const notificationPrefsSchema = z.object({
  notifyEnabled: z.boolean(),
  notifyFrequency: z.enum(["DAILY", "WEEKLY"]),
});

export type NotificationPrefsInput = z.infer<typeof notificationPrefsSchema>;
