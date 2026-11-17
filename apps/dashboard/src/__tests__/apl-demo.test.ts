import { describe, it, expect } from "vitest";
import { aplDemoPath, aplDemoRewrites, isAplDemoPath } from "@/lib/apl-demo";

const env = (path?: string, origin?: string) => ({ APL_DEMO_PATH: path, APL_DEMO_ORIGIN: origin }) as unknown as NodeJS.ProcessEnv;

describe("apl-demo proxy config", () => {
  it("normalises the secret path", () => {
    expect(aplDemoPath(env("demo-x"))).toBe("/demo-x");
    expect(aplDemoPath(env(" /demo-x/ "))).toBe("/demo-x");
    expect(aplDemoPath(env(""))).toBeNull();
    expect(aplDemoPath(env())).toBeNull();
  });

  it("builds no rewrites unless both path and origin are set", () => {
    expect(aplDemoRewrites(env("demo-x"))).toEqual([]);
    expect(aplDemoRewrites(env(undefined, "https://d.vercel.app"))).toEqual([]);
  });

  it("proxies the path and everything below it to the same path on the demo origin", () => {
    expect(aplDemoRewrites(env("demo-x", "https://d.vercel.app/"))).toEqual([
      { source: "/demo-x", destination: "https://d.vercel.app/demo-x" },
      { source: "/demo-x/:path*", destination: "https://d.vercel.app/demo-x/:path*" },
    ]);
  });

  it("matches the path and its children, not look-alikes", () => {
    const e = env("demo-x", "https://d.vercel.app");
    expect(isAplDemoPath("/demo-x", e)).toBe(true);
    expect(isAplDemoPath("/demo-x/agenzia", e)).toBe(true);
    expect(isAplDemoPath("/demo-xy", e)).toBe(false);
    expect(isAplDemoPath("/dashboard", e)).toBe(false);
  });
});
