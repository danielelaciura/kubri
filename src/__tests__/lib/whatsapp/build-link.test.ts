import { describe, it, expect } from "vitest";
import { buildWaLink } from "@/lib/whatsapp/build-link";

const NUMBER = "393331234567";
const TEMPLATE = "Ciao, vorrei candidarmi tramite Kubri.";

describe("buildWaLink", () => {
  it("does not prefix the message for a global pool", () => {
    const url = buildWaLink(
      { isGlobal: true, externalKey: "GLOBAL", slug: "global" },
      NUMBER,
      TEMPLATE,
    );
    expect(url).toBe(
      `https://wa.me/${NUMBER}?text=${encodeURIComponent(TEMPLATE)}`,
    );
  });

  it("prefixes externalKey for a non-global pool", () => {
    const url = buildWaLink(
      { isGlobal: false, externalKey: "MENSA01", slug: "mensa-milano" },
      NUMBER,
      TEMPLATE,
    );
    const expectedText = `[MENSA01] ${TEMPLATE}`;
    expect(url).toBe(
      `https://wa.me/${NUMBER}?text=${encodeURIComponent(expectedText)}`,
    );
  });

  it("falls back to slug when externalKey is null", () => {
    const url = buildWaLink(
      { isGlobal: false, externalKey: null, slug: "mensa-milano" },
      NUMBER,
      TEMPLATE,
    );
    const expectedText = `[mensa-milano] ${TEMPLATE}`;
    expect(url).toBe(
      `https://wa.me/${NUMBER}?text=${encodeURIComponent(expectedText)}`,
    );
  });

  it("encodes special characters (spaces, accents, commas, newlines)", () => {
    const tricky = "Ciao è così,\nbenvenuto!";
    const url = buildWaLink(
      { isGlobal: true, externalKey: null, slug: "x" },
      NUMBER,
      tricky,
    );
    expect(url).toBe(
      `https://wa.me/${NUMBER}?text=${encodeURIComponent(tricky)}`,
    );
    expect(url).toContain("%0A");
    expect(url).toContain("%C3%A8");
  });

  it("handles an empty template (still produces a valid url)", () => {
    const url = buildWaLink(
      { isGlobal: true, externalKey: null, slug: "x" },
      NUMBER,
      "",
    );
    expect(url).toBe(`https://wa.me/${NUMBER}?text=`);
  });

  it("includes prefix even with empty template when pool is not global", () => {
    const url = buildWaLink(
      { isGlobal: false, externalKey: "ABC", slug: "abc" },
      NUMBER,
      "",
    );
    expect(url).toBe(
      `https://wa.me/${NUMBER}?text=${encodeURIComponent("[ABC] ")}`,
    );
  });
});
