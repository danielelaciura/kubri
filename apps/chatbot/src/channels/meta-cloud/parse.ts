import { z } from "zod";

export type ParsedKind =
  "text" | "audio" | "image" | "document" | "interactive" | "location" | "unsupported";

export interface ParsedMessage {
  readonly phoneNumberId: string;
  readonly providerMessageId: string;
  readonly from: { readonly externalId: string; readonly phoneE164: string };
  readonly type: ParsedKind;
  readonly body: string | null;
  /** A tap on a button or a list row (D114). */
  readonly reply: { readonly id: string; readonly title: string } | null;
  readonly receivedAt: Date;
  /** The message as Meta sent it, for the audit trail and the dead letters. */
  readonly raw: unknown;
}

export type ParsedStatusKind = "sent" | "delivered" | "read" | "failed";

export interface ParsedStatus {
  readonly phoneNumberId: string;
  readonly providerMessageId: string;
  readonly status: ParsedStatusKind;
  readonly at: Date;
  /** Meta's error code of a failure. */
  readonly errorCode: number | null;
}

export interface ParsedPayload {
  readonly messages: readonly ParsedMessage[];
  readonly statuses: readonly ParsedStatus[];
  /** Other fields' changes, reactions: nothing to answer, nothing to keep. */
  readonly ignored: number;
  /** Items that looked like messages or statuses but could not be read: kept as dead letters. */
  readonly rejected: readonly unknown[];
}

const Envelope = z.object({
  object: z.literal("whatsapp_business_account"),
  entry: z.array(
    z.object({ changes: z.array(z.object({ field: z.string(), value: z.unknown() })) }),
  ),
});

const Value = z.object({
  metadata: z.object({ phone_number_id: z.string() }),
  messages: z.array(z.unknown()).optional(),
  statuses: z.array(z.unknown()).optional(),
});

const Tap = z.object({ id: z.string(), title: z.string() });

const Message = z.object({
  from: z.string().regex(/^\d+$/),
  id: z.string().min(1),
  timestamp: z.string().regex(/^\d+$/),
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
  interactive: z
    .object({ type: z.string(), button_reply: Tap.optional(), list_reply: Tap.optional() })
    .optional(),
  button: z.object({ text: z.string() }).optional(),
});

const Status = z.object({
  id: z.string().min(1),
  status: z.enum(["sent", "delivered", "read", "failed"]),
  timestamp: z.string().regex(/^\d+$/),
  errors: z.array(z.object({ code: z.number() })).optional(),
});

const SIMPLE: Readonly<Record<string, ParsedKind>> = {
  audio: "audio",
  image: "image",
  document: "document",
  location: "location",
};

const at = (seconds: string): Date => new Date(Number(seconds) * 1000);

function readMessage(
  phoneNumberId: string,
  item: z.infer<typeof Message>,
  raw: unknown,
): ParsedMessage | "ignored" {
  const base = {
    phoneNumberId,
    providerMessageId: item.id,
    from: { externalId: item.from, phoneE164: `+${item.from}` },
    receivedAt: at(item.timestamp),
    raw,
  };
  if (item.type === "reaction") return "ignored";
  if (item.type === "text" && item.text) {
    return { ...base, type: "text", body: item.text.body, reply: null };
  }
  // A quick-reply button of a template arrives as type "button": its text is what was tapped.
  if (item.type === "button" && item.button) {
    return { ...base, type: "text", body: item.button.text, reply: null };
  }
  if (item.type === "interactive" && item.interactive) {
    const tap = item.interactive.button_reply ?? item.interactive.list_reply;
    if (tap) {
      return {
        ...base,
        type: "interactive",
        body: tap.title,
        reply: { id: tap.id, title: tap.title },
      };
    }
  }
  const kind = Object.hasOwn(SIMPLE, item.type) ? SIMPLE[item.type] : undefined;
  return { ...base, type: kind ?? "unsupported", body: null, reply: null };
}

/**
 * D118: every entry, change, message and status. null = not a WhatsApp payload at all. The
 * tolerant schemas ignore fields Meta adds; an item that does not fit is kept in `rejected`.
 */
export function parseWebhook(json: unknown): ParsedPayload | null {
  const envelope = Envelope.safeParse(json);
  if (!envelope.success) return null;
  const messages: ParsedMessage[] = [];
  const statuses: ParsedStatus[] = [];
  const rejected: unknown[] = [];
  let ignored = 0;
  for (const entry of envelope.data.entry) {
    for (const change of entry.changes) {
      if (change.field !== "messages") {
        ignored += 1;
        continue;
      }
      const value = Value.safeParse(change.value);
      if (!value.success) {
        rejected.push(change.value);
        continue;
      }
      const phoneNumberId = value.data.metadata.phone_number_id;
      for (const raw of value.data.messages ?? []) {
        const item = Message.safeParse(raw);
        const message = item.success ? readMessage(phoneNumberId, item.data, raw) : null;
        if (message === "ignored") ignored += 1;
        else if (message) messages.push(message);
        else rejected.push(raw);
      }
      for (const raw of value.data.statuses ?? []) {
        const item = Status.safeParse(raw);
        if (!item.success) {
          rejected.push(raw);
          continue;
        }
        statuses.push({
          phoneNumberId,
          providerMessageId: item.data.id,
          status: item.data.status,
          at: at(item.data.timestamp),
          errorCode: item.data.errors?.[0]?.code ?? null,
        });
      }
    }
  }
  return { messages, statuses, ignored, rejected };
}
