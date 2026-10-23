import { describe, it, expect } from "vitest";
import { emptyCandidateDraftFields } from "@kubri/contracts";
import { toFieldErrors, toFormState, toSubmission, validateFormState } from "@/components/candidates/create/form-state";

describe("form-state", () => {
  it("round-trips draft fields", () => {
    const draft = {
      ...emptyCandidateDraftFields(),
      firstName: "Ahmed",
      drivingLicense: true,
      partTimePreference: false,
      workExperience: ["Magazziniere"],
    };
    const state = toFormState(draft);
    expect(state.firstName).toBe("Ahmed");
    expect(state.birthday).toBe("");
    expect(state.drivingLicense).toBe("true");
    expect(state.partTimePreference).toBe("false");
    expect(state.workingPermit).toBe("");
    expect(state.workExperience).toEqual(["Magazziniere"]);

    const out = toSubmission(state);
    expect(out.firstName).toBe("Ahmed");
    expect(out.birthday).toBeNull();
    expect(out.drivingLicense).toBe(true);
    expect(out.partTimePreference).toBe(false);
    expect(out.workingPermit).toBeNull();
  });

  it("reports required names and invalid email", () => {
    const state = toFormState(emptyCandidateDraftFields());
    state.email = "nope";
    const errors = validateFormState(state);
    expect(errors).toEqual({ firstName: "required", lastName: "required", email: "invalid" });
  });

  it("returns no errors for a valid state", () => {
    const state = toFormState({ ...emptyCandidateDraftFields(), firstName: "A", lastName: "B" });
    expect(validateFormState(state)).toEqual({});
  });

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
