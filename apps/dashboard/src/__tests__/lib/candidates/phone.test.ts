import { describe, it, expect } from "vitest";
import { normalizePhone } from "@/lib/candidates/phone";

describe("normalizePhone", () => {
  it("keeps digits of an international number", () => {
    expect(normalizePhone("+39 333 123 4567")).toBe("393331234567");
  });
  it("drops a 00 international prefix", () => {
    expect(normalizePhone("0039-333-1234567")).toBe("393331234567");
  });
  it("adds 39 to a 10-digit Italian mobile without prefix", () => {
    expect(normalizePhone("333 1234567")).toBe("393331234567");
  });
  it("leaves other countries alone", () => {
    expect(normalizePhone("+212 612 345 678")).toBe("212612345678");
  });
  it("returns null for empty or too short input", () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("12345")).toBeNull();
  });
});
