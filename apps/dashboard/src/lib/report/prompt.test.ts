import { describe, it, expect } from "vitest";
import { buildReportPrompt } from "./prompt";

describe("buildReportPrompt", () => {
  const answers = { q1: "analitico", q3: 4, esperienze: [{ ruolo: "Cameriere" }] };

  it("injects all five domain ids into the system prompt", () => {
    const { system } = buildReportPrompt(answers);
    for (const id of ["cognitive", "relational", "organizational", "technical", "motivation"]) {
      expect(system).toContain(id);
    }
  });

  it("includes the candidate answers in the user prompt", () => {
    const { user } = buildReportPrompt(answers);
    expect(user).toContain("Cameriere");
    expect(user).toContain("analitico");
  });

  it("never includes contact PII even if accidentally present", () => {
    const { system, user } = buildReportPrompt({
      ...answers,
      firstName: "Mario",
      phone: "+393331234567",
      email: "mario@x.it",
    } as Record<string, unknown>);
    const all = system + user;
    expect(all).not.toContain("Mario");
    expect(all).not.toContain("+393331234567");
    expect(all).not.toContain("mario@x.it");
  });
});
