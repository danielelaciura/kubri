import type { OutboundFile, OutboundText } from "../channel";
import { INTERACTIVE_BODY_LIMIT, shapeChoices, truncate } from "../interactive";

const HEADER = { messaging_product: "whatsapp", recipient_type: "individual" } as const;

/** Meta's limit on a media caption, in characters. */
const CAPTION_LIMIT = 1024;

/** The JSON of `POST /{phone-number-id}/messages` for one outbound message (D115, R8). */
export function sendBody(message: OutboundText): Record<string, unknown> {
  const to = message.to.externalId;
  if (message.document) {
    return {
      ...HEADER,
      to,
      type: "document",
      document: {
        id: message.document.mediaId,
        filename: message.document.filename,
        caption: truncate(message.text, CAPTION_LIMIT),
      },
    };
  }
  const shape = message.choices ? shapeChoices(message.choices) : ({ kind: "none" } as const);
  const body = { text: truncate(message.text, INTERACTIVE_BODY_LIMIT) };
  switch (shape.kind) {
    case "buttons":
      return {
        ...HEADER,
        to,
        type: "interactive",
        interactive: {
          type: "button",
          body,
          action: {
            buttons: shape.buttons.map(({ id, title }) => ({
              type: "reply",
              reply: { id, title },
            })),
          },
        },
      };
    case "list":
      return {
        ...HEADER,
        to,
        type: "interactive",
        interactive: {
          type: "list",
          body,
          action: { button: shape.button, sections: [{ rows: shape.rows }] },
        },
      };
    case "none":
      return { ...HEADER, to, type: "text", text: { preview_url: false, body: message.text } };
  }
}

/** The multipart form of `POST /{phone-number-id}/media`: the file to send later (R8). */
export function uploadForm(file: OutboundFile): FormData {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", file.mimeType);
  form.append("file", new Blob([file.bytes], { type: file.mimeType }), file.filename);
  return form;
}

/** Read receipt plus the "typing" indicator for an inbound message (spec §11.2 point 2). */
export function acknowledgeBody(providerMessageId: string): Record<string, unknown> {
  return {
    messaging_product: "whatsapp",
    status: "read",
    message_id: providerMessageId,
    typing_indicator: { type: "text" },
  };
}
