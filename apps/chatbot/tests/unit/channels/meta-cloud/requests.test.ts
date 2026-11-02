import { describe, expect, it } from "vitest";
import type { OutboundText } from "../../../../src/channels/channel";
import {
  acknowledgeBody,
  sendBody,
  uploadForm,
} from "../../../../src/channels/meta-cloud/requests";

const BASE: OutboundText = {
  clientMessageId: "m1",
  sender: { id: "s1", slug: "kubri-main", provider: "meta", providerConfig: {} },
  to: { externalId: "393334445566", phoneE164: "+393334445566" },
  text: "Accetti di proseguire?",
};
const choices = (n: number) => ({
  listButton: "Scegli",
  options: Array.from({ length: n }, (_, i) => ({ id: `o${i}`, title: `Voce ${i}` })),
});

describe("sendBody", () => {
  it("builds a text message", () => {
    expect(sendBody(BASE)).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "393334445566",
      type: "text",
      text: { preview_url: false, body: "Accetti di proseguire?" },
    });
  });

  it("builds reply buttons for two or three choices", () => {
    expect(sendBody({ ...BASE, choices: choices(2) })).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "393334445566",
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: "Accetti di proseguire?" },
        action: {
          buttons: [
            { type: "reply", reply: { id: "o0", title: "Voce 0" } },
            { type: "reply", reply: { id: "o1", title: "Voce 1" } },
          ],
        },
      },
    });
  });

  it("builds a list for four to ten choices", () => {
    const body = sendBody({ ...BASE, choices: choices(4) });

    expect(body).toMatchObject({
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: "Accetti di proseguire?" },
        action: {
          button: "Scegli",
          sections: [
            { rows: [{ id: "o0", title: "Voce 0" }, { id: "o1" }, { id: "o2" }, { id: "o3" }] },
          ],
        },
      },
    });
    expect(JSON.stringify(body)).not.toContain('"description"');
  });

  it("falls back to text when the choices do not fit a widget", () => {
    expect(sendBody({ ...BASE, choices: choices(1) })).toMatchObject({ type: "text" });
    expect(sendBody({ ...BASE, choices: choices(11) })).toMatchObject({ type: "text" });
  });

  it("cuts a body that is too long for a widget (the runtime splits it first, D115)", () => {
    const body = sendBody({ ...BASE, text: "x".repeat(2000), choices: choices(2) }) as {
      interactive: { body: { text: string } };
    };

    expect(Array.from(body.interactive.body.text)).toHaveLength(1024);
  });
});

describe("sendBody with a document (R8)", () => {
  const document = { mediaId: "media-1", filename: "CV.pdf" };

  it("sends the uploaded file with the text as its caption", () => {
    expect(sendBody({ ...BASE, text: "Ecco il tuo CV", document })).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "393334445566",
      type: "document",
      document: { id: "media-1", filename: "CV.pdf", caption: "Ecco il tuo CV" },
    });
  });

  it("wins over the choices", () => {
    expect(sendBody({ ...BASE, document, choices: choices(2) })).toMatchObject({
      type: "document",
    });
  });

  it("cuts a caption longer than Meta allows", () => {
    const body = sendBody({ ...BASE, text: "x".repeat(2000), document }) as {
      document: { caption: string };
    };

    expect(Array.from(body.document.caption)).toHaveLength(1024);
  });
});

describe("uploadForm (R8)", () => {
  it("is the multipart form of POST /{phone-number-id}/media", async () => {
    const bytes = new Uint8Array([37, 80, 68, 70, 45]);

    const form = uploadForm({ bytes, filename: "CV.pdf", mimeType: "application/pdf" });

    expect(form.get("messaging_product")).toBe("whatsapp");
    expect(form.get("type")).toBe("application/pdf");
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("expected a file part");
    expect(file.name).toBe("CV.pdf");
    expect(file.type).toBe("application/pdf");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
  });
});

describe("acknowledgeBody", () => {
  it("marks a message read and shows the typing indicator", () => {
    expect(acknowledgeBody("wamid.1")).toEqual({
      messaging_product: "whatsapp",
      status: "read",
      message_id: "wamid.1",
      typing_indicator: { type: "text" },
    });
  });
});
