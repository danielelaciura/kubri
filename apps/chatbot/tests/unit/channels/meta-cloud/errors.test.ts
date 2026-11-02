import { describe, expect, it } from "vitest";
import { classifyError, errorName } from "../../../../src/channels/meta-cloud/errors";

const body = (code: number) => ({
  error: { message: "x", type: "OAuthException", code, fbtrace_id: "t" },
});

describe("classifyError (D119)", () => {
  it.each([
    [131047, "permanent", "outside_window"],
    [131026, "permanent", "not_reachable"],
    [131030, "permanent", "not_allowed"],
    [131051, "permanent", "unsupported_type"],
    [100, "permanent", "invalid_request"],
    [190, "permanent", "auth_failed"],
    [130429, "transient", "rate_limited"],
    [131056, "transient", "rate_limited"],
    [80007, "transient", "rate_limited"],
    [4, "transient", "rate_limited"],
    [131000, "transient", "meta_unavailable"],
    [2, "transient", "meta_unavailable"],
  ])("code %i is %s (%s)", (code, kind, name) => {
    expect(classifyError(400, body(code))).toEqual({ ok: false, kind, code: name });
  });

  it("decides from the HTTP status when the code is unknown", () => {
    expect(classifyError(500, {})).toEqual({ ok: false, kind: "transient", code: "http_500" });
    expect(classifyError(503, null)).toEqual({ ok: false, kind: "transient", code: "http_503" });
    expect(classifyError(429, {})).toEqual({ ok: false, kind: "transient", code: "rate_limited" });
    expect(classifyError(408, {})).toEqual({ ok: false, kind: "transient", code: "http_408" });
    expect(classifyError(400, body(999999))).toEqual({
      ok: false,
      kind: "permanent",
      code: "meta_999999",
    });
    expect(classifyError(404, {})).toEqual({ ok: false, kind: "permanent", code: "http_404" });
  });
});

describe("errorName (C3)", () => {
  it("names a code like classifyError does, so a send and a delivery failure match", () => {
    expect(errorName(131047)).toBe("outside_window");
    expect(errorName(130429)).toBe("rate_limited");
    expect(errorName(999999)).toBe("meta_999999");
  });
});
