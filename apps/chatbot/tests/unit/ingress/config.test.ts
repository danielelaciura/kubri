import { describe, expect, it } from "vitest";
import { parseGraphVersion, parseWebConfig } from "../../../src/ingress/config";

describe("parseWebConfig", () => {
  it("needs the app secret and the verify token, and defaults the Graph version", () => {
    expect(parseWebConfig({ META_APP_SECRET: "s", META_VERIFY_TOKEN: "t" })).toEqual({
      appSecret: "s",
      verifyToken: "t",
      graphVersion: "v23.0",
    });
    expect(
      parseWebConfig({ META_APP_SECRET: "s", META_VERIFY_TOKEN: "t", META_GRAPH_VERSION: "v24.0" })
        .graphVersion,
    ).toBe("v24.0");
  });

  it("names what is missing without echoing any value", () => {
    expect(() => parseWebConfig({})).toThrow(/META_APP_SECRET/);
    expect(() =>
      parseWebConfig({
        META_APP_SECRET: "topsecret",
        META_VERIFY_TOKEN: "t",
        META_GRAPH_VERSION: "latest",
      }),
    ).toThrow(/META_GRAPH_VERSION/);
    expect(() =>
      parseWebConfig({
        META_APP_SECRET: "topsecret",
        META_VERIFY_TOKEN: "t",
        META_GRAPH_VERSION: "latest",
      }),
    ).not.toThrow(/topsecret/);
  });
});

describe("parseGraphVersion", () => {
  it("is all the worker needs", () => {
    expect(parseGraphVersion({})).toBe("v23.0");
    expect(parseGraphVersion({ META_GRAPH_VERSION: "v22.0" })).toBe("v22.0");
    expect(() => parseGraphVersion({ META_GRAPH_VERSION: "22" })).toThrow(/META_GRAPH_VERSION/);
  });
});
