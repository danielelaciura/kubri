import { describe, expect, it } from "vitest";
import { MetaProviderConfigSchema, SecretRefSchema } from "../../../src/channels/provider-config";

describe("SecretRefSchema", () => {
  it("accepts the name of a secret", () => {
    expect(SecretRefSchema.safeParse("META_TOKEN_KUBRI_MAIN").success).toBe(true);
  });

  it.each(["EAAGm0PX4ZCpsBA1234abcd", "meta_token", "", "AB"])("rejects %j", (value) => {
    expect(SecretRefSchema.safeParse(value).success).toBe(false);
  });
});

describe("MetaProviderConfigSchema", () => {
  const valid = {
    phoneNumberId: "123456789012345",
    wabaId: "987654321098765",
    accessTokenSecret: "META_TOKEN_KUBRI_MAIN",
  };

  it("accepts identifiers and a secret reference", () => {
    expect(MetaProviderConfigSchema.parse(valid)).toEqual(valid);
  });

  it("rejects extra keys, so a raw token cannot sneak in", () => {
    expect(MetaProviderConfigSchema.safeParse({ ...valid, accessToken: "EAAG..." }).success).toBe(
      false,
    );
  });

  it("rejects non-numeric ids", () => {
    expect(MetaProviderConfigSchema.safeParse({ ...valid, phoneNumberId: "abc" }).success).toBe(
      false,
    );
  });
});
