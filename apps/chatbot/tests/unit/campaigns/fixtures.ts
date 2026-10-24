import type { CampaignInput } from "../../../src/campaigns/schema/campaign";

/** A small but complete valid campaign. Tests clone it and break one thing at a time. */
export function minimalCampaign(): CampaignInput {
  return {
    campaign: "acme-magazzino",
    organization: "acme",
    externalKey: "acme",
    trigger: { sender: "kubri-main", keywords: ["acme"] },
    dataController: { name: "ACME S.r.l.", privacyUrl: "https://example.com/privacy" },
    customFields: [
      {
        key: "night_shifts",
        type: "bool",
        label: { it: "Turni notturni" },
        description: "Disponibile a lavorare di notte.",
      },
    ],
    texts: {
      cv_explain: { it: "Un CV è un documento che riassume le tue esperienze." },
    },
    flow: [
      { id: "intro", type: "message", text: { it: "Ciao! Ti farò qualche domanda." } },
      {
        id: "cv_info",
        type: "choice",
        prompt: { it: "Sai cos'è un CV?" },
        options: [
          { id: "yes", description: "Sa cos'è un CV e vuole proseguire" },
          { id: "no", description: "Non vuole proseguire" },
          { id: "idk", description: "Non sa cos'è un CV" },
        ],
        on: { no: "@stop", idk: { reply: "cv_explain", then: "@repeat" } },
      },
      {
        id: "privacy",
        type: "consent",
        consentKey: "acme_privacy",
        textVersion: "2026-10",
        text: { it: "Accetti l'informativa sulla privacy?" },
        link: "https://example.com/privacy",
      },
      {
        id: "anagrafica",
        type: "questions",
        questions: [
          { id: "nome", field: "firstName", prompt: { it: "Come ti chiami?" } },
          { id: "patente", field: "drivingLicense", prompt: { it: "Hai la patente?" } },
          {
            id: "notte",
            field: "custom.night_shifts",
            prompt: { it: "Lavoreresti anche di notte?" },
            when: { field: "drivingLicense", eq: true },
          },
        ],
      },
      { id: "fine", type: "end", text: { it: "Grazie!" } },
    ],
  };
}
