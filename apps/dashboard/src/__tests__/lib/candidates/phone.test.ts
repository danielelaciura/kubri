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
  it("does not add 39 to a 10-digit international number", () => {
    expect(normalizePhone("+354 612 3456")).toBe("3546123456");
  });
  it("does not add 39 after a 00 prefix", () => {
    expect(normalizePhone("0035461234567")).toBe("35461234567");
  });
  it("leaves 10-digit numbers not starting with 3 unchanged", () => {
    expect(normalizePhone("02 1234 5678")).toBe("0212345678");
  });
  it("returns null for empty or too short input", () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("12345")).toBeNull();
  });
});
