import { describe, expect, it } from "vitest";
import { parseKubriConfig, readKubriConfig } from "../../../src/integrations/config";

const VALID = { KUBRI_BASE_URL: "https://app.kubri.it/", CHATBOT_WEBHOOK_SECRET: "s3cret" };

describe("parseKubriConfig (spec §12.1, R3)", () => {
  it("needs the base URL and the shared secret, and drops the trailing slash", () => {
    expect(parseKubriConfig(VALID)).toEqual({ baseUrl: "https://app.kubri.it", secret: "s3cret" });
  });

  it("names the missing variables", () => {
    expect(() => parseKubriConfig({})).toThrow(/KUBRI_BASE_URL/);
    expect(() => parseKubriConfig({})).toThrow(/CHATBOT_WEBHOOK_SECRET/);
    expect(() => parseKubriConfig({ ...VALID, CHATBOT_WEBHOOK_SECRET: "  " })).toThrow(
      /CHATBOT_WEBHOOK_SECRET/,
    );
  });

  it("trims the secret, as the dashboard does", () => {
    expect(parseKubriConfig({ ...VALID, CHATBOT_WEBHOOK_SECRET: " s3cret\n" }).secret).toBe(
      "s3cret",
    );
  });

  it("refuses a URL that is not http(s), without echoing the secret", () => {
    const source = { KUBRI_BASE_URL: "ftp://x", CHATBOT_WEBHOOK_SECRET: "topsecret" };

    expect(() => parseKubriConfig(source)).toThrow(/KUBRI_BASE_URL/);
    expect(() => parseKubriConfig(source)).not.toThrow(/topsecret/);
  });
});

describe("readKubriConfig (R9)", () => {
  it("is null when neither variable is set", () => {
    expect(readKubriConfig({})).toBeNull();
    expect(readKubriConfig({ KUBRI_BASE_URL: "", CHATBOT_WEBHOOK_SECRET: " " })).toBeNull();
  });

  it("reads both", () => {
    expect(readKubriConfig(VALID)).toEqual({ baseUrl: "https://app.kubri.it", secret: "s3cret" });
  });

  it("refuses a half-filled configuration: that is a mistake, not a choice", () => {
    expect(() => readKubriConfig({ KUBRI_BASE_URL: "https://app.kubri.it" })).toThrow(
      /CHATBOT_WEBHOOK_SECRET/,
    );
    expect(() => readKubriConfig({ CHATBOT_WEBHOOK_SECRET: "s" })).toThrow(/KUBRI_BASE_URL/);
  });
});
