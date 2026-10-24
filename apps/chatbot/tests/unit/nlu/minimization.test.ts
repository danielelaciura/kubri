import { describe, expect, it } from "vitest";
import type { SessionState } from "../../../src/engine/state";
import { buildInterpretContext } from "../../../src/nlu/context";
import { interpretMessages } from "../../../src/nlu/interpret-messages";
import { atQuestion, campaign, inferred } from "../engine/helpers";

// Synthetic data only (CLAUDE.md): never real candidates.
const PERSONAL = {
  firstName: "Mariangela",
  lastName: "Bertolucci",
  birthday: "1990-05-12",
  address: "Via Garibaldi 12",
  email: "mariangela.b@example.com",
  phone: "+393331234567",
};

const STATE: SessionState = atQuestion("patente", {
  profile: {
    firstName: inferred(PERSONAL.firstName),
    lastName: inferred(PERSONAL.lastName),
    birthday: inferred(PERSONAL.birthday),
    address: inferred(PERSONAL.address),
    email: inferred(PERSONAL.email),
    phone: { value: PERSONAL.phone, confidence: 1, status: "confirmed" },
    lat: { value: 44.49, confidence: 1, status: "confirmed" },
    transport: inferred("bicicletta"),
  },
  pendingConfirmation: {
    kind: "value",
    field: "lastName",
    value: PERSONAL.lastName,
    confidence: 0.5,
  },
});

const HISTORY = [
  "mi chiamo Mariangela Bertolucci",
  "sono nata il 12/05/1990 e abito in via Garibaldi 12",
  "la mia mail è mariangela.b@example.com",
];

function sent(message: string, state: SessionState = STATE): string {
  const context = buildInterpretContext(
    { text: message, state, campaign: campaign(), history: HISTORY, turnId: null },
    3,
  );
  return JSON.stringify(interpretMessages(context, message));
}

describe("data minimization towards the LLM (spec §8.2, D85)", () => {
  it.each(Object.entries(PERSONAL))("never sends the collected %s", (_field, value) => {
    expect(sent("sì")).not.toContain(value);
  });

  it("never sends the 12/05/1990 form of the birth date nor the coordinates", () => {
    const payload = sent("sì");

    expect(payload).not.toContain("12/05/1990");
    expect(payload).not.toContain("44.49");
  });

  it("keeps the meaning of earlier messages with placeholders", () => {
    const payload = sent("sì");

    expect(payload).toContain("mi chiamo [firstName] [lastName]");
    expect(payload).toContain("abito in [address]");
  });

  it("still sends non-personal collected values", () => {
    expect(sent("sì")).toContain("bicicletta");
  });

  it("never sends a personal value still waiting for its confirmation", () => {
    const state: SessionState = atQuestion("nome", {
      pendingConfirmation: { kind: "value", field: "firstName", value: "Mrio", confidence: 0.5 },
    });
    const context = buildInterpretContext(
      { text: "sì", state, campaign: campaign(), history: ["mi chiamo Mrio"], turnId: null },
      3,
    );
    const payload = JSON.stringify(interpretMessages(context, "sì"));

    expect(payload).not.toContain("Mrio");
    expect(payload).toContain("mi chiamo [firstName]");
  });

  it("sends the current message whole: it is what must be interpreted", () => {
    expect(sent("no, il mio cognome è Rossi")).toContain("no, il mio cognome è Rossi");
  });
});
