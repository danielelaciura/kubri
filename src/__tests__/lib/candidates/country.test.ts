import { describe, it, expect } from "vitest";
import { displayCountry } from "@/lib/candidates/country";

describe("displayCountry", () => {
  it("maps a known ISO-2 code to the localized name", () => {
    expect(displayCountry("IT", "it")).toBe("Italia");
    expect(displayCountry("IT", "en")).toBe("Italy");
    expect(displayCountry("ES", "it")).toBe("Spagna");
    expect(displayCountry("ES", "en")).toBe("Spain");
  });

  it("is case-insensitive on the ISO code", () => {
    expect(displayCountry("it", "en")).toBe("Italy");
  });

  it("passes through legacy full country names unchanged", () => {
    expect(displayCountry("Italia", "it")).toBe("Italia");
    expect(displayCountry("Italy", "en")).toBe("Italy");
  });

  it("passes through unassigned 2-letter codes unchanged", () => {
    expect(displayCountry("JJ", "it")).toBe("JJ");
  });

  it("preserves null/empty as null", () => {
    expect(displayCountry(null, "it")).toBeNull();
    expect(displayCountry(undefined, "it")).toBeNull();
    expect(displayCountry("", "it")).toBeNull();
    expect(displayCountry("   ", "it")).toBeNull();
  });
});
