import { describe, expect, it } from "vitest";
import type { ProfileSnapshot } from "../../../src/engine/profile-snapshot";
import type { PendingConfirmation } from "../../../src/engine/state";
import type { CustomFieldDefinition } from "../../../src/profile/custom-fields";
import {
  isWithheldField,
  redactWithEvidence,
  scrubHistory,
  WITHHELD_FIELDS,
} from "../../../src/nlu/minimize";
import { inferred, interpretation } from "../engine/helpers";

const CUSTOM: CustomFieldDefinition[] = [
  {
    key: "disability",
    type: "text",
    label: { it: "Invalidità" },
    description: "Invalidità civile dichiarata.",
    sensitive: true,
  },
  { key: "night_shifts", type: "bool", label: { it: "Notte" }, description: "Turni di notte." },
];

const PROFILE: ProfileSnapshot = {
  firstName: inferred("Mariangela"),
  lastName: inferred("Bertolucci"),
  birthday: inferred("1990-05-02"),
  address: inferred("Via Garibaldi 12"),
  email: inferred("mb@example.com"),
  transport: inferred("bicicletta"),
  location: inferred("Bo"),
};

const scrub = (
  history: string[],
  profile: ProfileSnapshot,
  pending: PendingConfirmation | null = null,
): string[] => scrubHistory(history, { profile, pending, customFields: CUSTOM });

describe("WITHHELD_FIELDS", () => {
  it("lists the personal data of spec §8.2", () => {
    expect([...WITHHELD_FIELDS].sort()).toEqual(
      ["address", "birthday", "email", "firstName", "lastName", "lat", "lng", "phone"].sort(),
    );
  });
});

describe("isWithheldField", () => {
  it("covers personal data and sensitive fields, standard or custom", () => {
    expect(isWithheldField("firstName", CUSTOM)).toBe(true);
    expect(isWithheldField("workingPermit", CUSTOM)).toBe(true);
    expect(isWithheldField("jobPreferences.constraints", CUSTOM)).toBe(true);
    expect(isWithheldField("custom.disability", CUSTOM)).toBe(true);
    expect(isWithheldField("custom.night_shifts", CUSTOM)).toBe(false);
    expect(isWithheldField("transport", CUSTOM)).toBe(false);
  });
});

describe("scrubHistory", () => {
  it("replaces collected personal data with the field name, ignoring case", () => {
    expect(
      scrub(
        ["mi chiamo MARIANGELA bertolucci", "abito in via garibaldi 12, scrivi a mb@example.com"],
        PROFILE,
      ),
    ).toEqual(["mi chiamo [firstName] [lastName]", "abito in [address], scrivi a [email]"]);
  });

  it("also replaces e-mails and phone numbers that were never collected", () => {
    expect(scrub(["scrivi a altro@example.org o al 333 123 4567"], {})).toEqual([
      "scrivi a [email] o al [phone]",
    ]);
  });

  it("recognizes the birth date written the Italian way", () => {
    expect(scrub(["sono nata il 02/05/1990", "cioè il 2/5/1990"], PROFILE)).toEqual([
      "sono nata il [birthday]",
      "cioè il [birthday]",
    ]);
  });

  it("keeps the values of other fields", () => {
    expect(scrub(["vado in bicicletta a Bo"], PROFILE)).toEqual(["vado in bicicletta a Bo"]);
  });

  it("scrubs the values of sensitive fields, standard or custom", () => {
    expect(
      scrub(["ho un'invalidità al 40%, e devo accudire mia madre"], {
        "custom.disability": inferred("invalidità al 40%"),
        "jobPreferences.constraints": inferred("devo accudire mia madre"),
      }),
    ).toEqual(["ho un'[custom.disability], e [jobPreferences.constraints]"]);
  });

  it("scrubs two-letter names as whole words, never longer values shorter than three", () => {
    expect(scrub(["Li Wei, vivo a Linate"], { lastName: inferred("Li") })).toEqual([
      "[lastName] Wei, vivo a Linate",
    ]);
    expect(scrub(["sono di Bo"], { address: inferred("Bo") })).toEqual(["sono di Bo"]);
  });

  it("matches whole words only, so other words keep their meaning", () => {
    expect(scrub(["Ada, sono adatta"], { firstName: inferred("Ada") })).toEqual([
      "[firstName], sono adatta",
    ]);
  });

  it("treats regular-expression characters in values literally", () => {
    // Not an e-mail: the contact regex would catch both forms and hide the point.
    const profile: ProfileSnapshot = { address: inferred("Via A.B+ 3") };

    expect(scrub(["Via A.B+ 3 e Via AXBB 3"], profile)).toEqual(["[address] e Via AXBB 3"]);
  });

  it("also scrubs the personal values of a pending confirmation, not yet saved", () => {
    expect(
      scrub(
        ["mi chiamo Mrio"],
        {},
        {
          kind: "value",
          field: "firstName",
          value: "Mrio",
          confidence: 0.5,
        },
      ),
    ).toEqual(["mi chiamo [firstName]"]);
    expect(
      scrub(
        ["era Rossi, è Rossini"],
        {},
        {
          kind: "edit",
          field: "lastName",
          oldValue: "Rossi",
          newValue: "Rossini",
        },
      ),
    ).toEqual(["era [lastName], è [lastName]"]);
  });

  it("keeps the pending value of a field that is not personal", () => {
    expect(
      scrub(
        ["vado in bici"],
        {},
        {
          kind: "value",
          field: "transport",
          value: "bici",
          confidence: 0.5,
        },
      ),
    ).toEqual(["vado in bici"]);
    expect(scrub(["vado in bici"], {}, { kind: "delete_data" })).toEqual(["vado in bici"]);
  });
});

const entry = (field: string, value: unknown, evidence: string, confidence = 0.95) => ({
  field,
  value,
  confidence,
  evidence,
});

describe("redactWithEvidence", () => {
  it("replaces the evidence of personal and sensitive fields, whatever was saved", () => {
    const result = redactWithEvidence(
      "Mi chiamo Mariangela, ho il permesso di soggiorno e vado in bici",
      interpretation({
        patch: [
          // Low confidence: the engine will only ask to confirm it; still redacted.
          entry("firstName", "Mariangela", "Mariangela", 0.5),
          entry("workingPermit", true, "ho il permesso di soggiorno"),
          entry("transport", "bicicletta", "in bici"),
        ],
      }),
      CUSTOM,
    );

    expect(result).toBe("Mi chiamo [firstName], [workingPermit] e vado in bici");
  });

  it("also replaces the written value when the evidence does not match the message", () => {
    expect(
      redactWithEvidence(
        "scrivete a mb@example.com",
        interpretation({ patch: [entry("email", "mb@example.com", "la mia mail")] }),
        CUSTOM,
      ),
    ).toBe("scrivete a [email]");
  });

  it("covers the evidence and value of custom sensitive fields and the edit target", () => {
    expect(
      redactWithEvidence(
        "ho un'invalidità al 40%. Il cognome giusto è Rossini",
        interpretation({
          intent: "edit_request",
          patch: [entry("custom.disability", "invalidità al 40%", "invalidità al 40%")],
          editTarget: { field: "lastName", newValue: "Rossini" },
        }),
        CUSTOM,
      ),
    ).toBe("ho un'[custom.disability]. Il cognome giusto è [lastName]");
  });

  it("leaves a message without e-mails or phone numbers alone without an interpretation", () => {
    expect(redactWithEvidence("mi chiamo Mario", null, CUSTOM)).toBe("mi chiamo Mario");
  });

  it.each([
    [null, "scrivimi a mario.rossi+lavoro@example.co.uk o chiama il +39 333-123 4567"],
    [
      interpretation({ intent: "unclear" }),
      "scrivimi a mario.rossi+lavoro@example.co.uk o chiama il +39 333-123 4567",
    ],
  ])("replaces e-mails and phone numbers even without a usable interpretation", (interp, text) => {
    expect(redactWithEvidence(text, interp, CUSTOM)).toBe("scrivimi a [email] o chiama il [phone]");
  });

  it.each(["3331234567", "06 1234 5678", "0039-333-1234567"])(
    "replaces the phone-like digit run %j",
    (phone) => {
      expect(redactWithEvidence(`numero ${phone}.`, null, CUSTOM)).toBe("numero [phone].");
    },
  );

  it.each([
    "Via Roma 12, 40121 Bologna",
    "ho lavorato dal 2019 al 2023",
    "2015-2020 magazziniere",
    "12/05/1990",
    "ho 3 figli e 25 anni",
  ])("keeps short numbers, years and dates: %j", (text) => {
    expect(redactWithEvidence(text, null, CUSTOM)).toBe(text);
  });

  it("applies the regex after the field redaction", () => {
    expect(
      redactWithEvidence(
        "mail mb@example.com, tel 333 1234567",
        interpretation({ patch: [entry("email", "mb@example.com", "mb@example.com")] }),
        CUSTOM,
      ),
    ).toBe("mail [email], tel [phone]");
  });
});
