import { describe, it, expect } from "vitest";
import { toFieldErrors } from "@/lib/candidates/field-errors";

describe("toFieldErrors", () => {
  it("maps issues to field errors, first issue per field wins", () => {
    expect(
      toFieldErrors([
        { code: "too_small", path: ["lastName"] },
        { code: "invalid_format", path: ["lastName"] },
        { code: "invalid_format", path: ["email"] },
        { code: "custom", path: [] },
      ]),
    ).toEqual({ lastName: "required", email: "invalid" });
  });
});
