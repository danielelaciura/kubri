import { describe, it, expect } from "vitest";
import { MIN_CV_TEXT_CHARS, passesCvQualityGate } from "@/lib/documents/quality";

const filler = (n: number) => "x".repeat(n);

describe("passesCvQualityGate", () => {
  it("rejects short text even with signals", () => {
    expect(passesCvQualityGate("Esperienza 2019 mario@example.com")).toBe(false);
  });

  it("rejects long text without any CV signal", () => {
    expect(passesCvQualityGate(`${filler(MIN_CV_TEXT_CHARS + 50)} lorem ipsum`)).toBe(false);
  });

  it.each([
    "Telefono +39 333 123 4567",
    "mario.rossi@example.com",
    "Magazziniere dal 2018",
    "Esperienze lavorative",
    "Work experience",
    "Expérience professionnelle et formation",
    "Experiencia laboral",
  ])("accepts long text with a signal: %s", (signal) => {
    expect(passesCvQualityGate(`${filler(MIN_CV_TEXT_CHARS)} ${signal}`)).toBe(true);
  });

  it("does not count whitespace toward the minimum", () => {
    expect(passesCvQualityGate(`${" \n".repeat(400)} 2019`)).toBe(false);
  });
});
