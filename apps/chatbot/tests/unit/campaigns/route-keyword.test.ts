import { describe, expect, it } from "vitest";
import { routeKeywords, stripRouteToken } from "../../../src/campaigns/route-keyword";

describe("routeKeywords (D143)", () => {
  it("reads the slug in square brackets, as the dashboard's links and QR codes write it", () => {
    expect(routeKeywords("[coop-abc] Ciao! Vorrei candidarmi")).toEqual([
      "coop-abc",
      "[coop-abc] ciao! vorrei candidarmi",
    ]);
  });

  it("finds the brackets anywhere in the message, ignoring case and spaces inside", () => {
    expect(routeKeywords("Ciao [ Coop-ABC ]")[0]).toBe("coop-abc");
  });

  it("uses only the first bracketed token", () => {
    expect(routeKeywords("[uno] e [due]")[0]).toBe("uno");
  });

  it("still knows a keyword written alone", () => {
    expect(routeKeywords("  ACME ")).toEqual(["acme"]);
  });

  it("ignores empty or overlong brackets", () => {
    expect(routeKeywords("[] ciao")).toEqual(["[] ciao"]);
    expect(routeKeywords(`[${"x".repeat(65)}] ciao`)).toHaveLength(1);
  });
});

describe("stripRouteToken", () => {
  it("removes a leading bracketed token, so the NLU reads only what the candidate wrote", () => {
    expect(stripRouteToken("[coop-abc] Ciao! Vorrei candidarmi")).toBe("Ciao! Vorrei candidarmi");
  });

  it("leaves the text alone otherwise, and never returns an empty text", () => {
    expect(stripRouteToken("ciao [x]")).toBe("ciao [x]");
    expect(stripRouteToken("[coop-abc]")).toBe("[coop-abc]");
  });
});
