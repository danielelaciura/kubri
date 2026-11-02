import type { OutboundText } from "../channel";
import { INTERACTIVE_BODY_LIMIT, shapeChoices, truncate } from "../interactive";

const HEADER = { messaging_product: "whatsapp", recipient_type: "individual" } as const;

/** The JSON of `POST /{phone-number-id}/messages` for one outbound message (D115). */
export function sendBody(message: OutboundText): Record<string, unknown> {
  const to = message.to.externalId;
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

/** Read receipt plus the "typing" indicator for an inbound message (spec §11.2 point 2). */
export function acknowledgeBody(providerMessageId: string): Record<string, unknown> {
  return {
    messaging_product: "whatsapp",
    status: "read",
    message_id: providerMessageId,
    typing_indicator: { type: "text" },
  };
}
