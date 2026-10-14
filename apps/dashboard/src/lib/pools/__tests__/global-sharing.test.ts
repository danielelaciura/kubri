import { describe, it, expect } from "vitest";
import { resolveSharedWithGlobal } from "@/lib/pools/global-sharing";

describe("resolveSharedWithGlobal", () => {
  it("WEBHOOK follows the payload consent", () => {
    const pool = { isGlobal: false, globalSharing: "WEBHOOK" as const };
    expect(resolveSharedWithGlobal(pool, true)).toBe(true);
    expect(resolveSharedWithGlobal(pool, false)).toBe(false);
  });

  it("ALWAYS forces true regardless of consent", () => {
    const pool = { isGlobal: false, globalSharing: "ALWAYS" as const };
    expect(resolveSharedWithGlobal(pool, false)).toBe(true);
    expect(resolveSharedWithGlobal(pool, true)).toBe(true);
  });

  it("NEVER forces false regardless of consent", () => {
    const pool = { isGlobal: false, globalSharing: "NEVER" as const };
    expect(resolveSharedWithGlobal(pool, true)).toBe(false);
    expect(resolveSharedWithGlobal(pool, false)).toBe(false);
  });

  it("ignores the mode on the Global pool and follows the payload", () => {
    expect(resolveSharedWithGlobal({ isGlobal: true, globalSharing: "ALWAYS" }, false)).toBe(false);
    expect(resolveSharedWithGlobal({ isGlobal: true, globalSharing: "NEVER" }, true)).toBe(true);
  });
});
