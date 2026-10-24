import { describe, expect, it } from "vitest";
import { canonicalCampaign, canonicalize } from "../../../src/campaigns/checksum";
import { minimalCampaign, parsed } from "./fixtures";

describe("canonicalize", () => {
  it("sorts object keys at every depth", () => {
    const result = canonicalize({ b: 1, a: { d: [{ z: 1, y: 2 }], c: true } });

    expect(JSON.stringify(result)).toBe('{"a":{"c":true,"d":[{"y":2,"z":1}]},"b":1}');
  });

  it("keeps array order", () => {
    expect(canonicalize([3, 1, 2])).toEqual([3, 1, 2]);
  });

  it("drops undefined properties", () => {
    expect(canonicalize({ a: 1, b: undefined })).toEqual({ a: 1 });
  });

  it("rejects values JSON cannot represent", () => {
    expect(() => canonicalize(Number.NaN)).toThrow(TypeError);
    expect(() => canonicalize(() => 1)).toThrow(TypeError);
  });
});

describe("canonicalCampaign", () => {
  it("produces a sha256 hex checksum", () => {
    expect(canonicalCampaign(parsed(minimalCampaign())).checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ignores key order", () => {
    const original = minimalCampaign();
    const reordered = Object.fromEntries(Object.entries(original).reverse()) as typeof original;

    expect(canonicalCampaign(parsed(reordered)).checksum).toBe(
      canonicalCampaign(parsed(original)).checksum,
    );
  });

  it("ignores defaults spelled out explicitly", () => {
    const explicit = minimalCampaign();
    explicit.defaultLanguage = "it";
    explicit.onStop = { data: "delete" };

    expect(canonicalCampaign(parsed(explicit)).checksum).toBe(
      canonicalCampaign(parsed(minimalCampaign())).checksum,
    );
  });

  it("changes when the content changes", () => {
    const changed = minimalCampaign();
    changed.externalKey = "acme-2";

    expect(canonicalCampaign(parsed(changed)).checksum).not.toBe(
      canonicalCampaign(parsed(minimalCampaign())).checksum,
    );
  });
});
