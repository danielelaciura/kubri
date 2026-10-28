import { describe, expect, it } from "vitest";
import { withDeadline } from "../../../src/runtime/deadline";

const later = <T>(ms: number, value: T) =>
  new Promise<T>((resolve) =>
    setTimeout(() => {
      resolve(value);
    }, ms),
  );

describe("withDeadline", () => {
  it("returns the value when the work finishes in time", async () => {
    expect(await withDeadline(later(5, "ok"), 500)).toEqual({ timedOut: false, value: "ok" });
  });

  it("gives up when the work is too slow", async () => {
    expect(await withDeadline(later(200, "late"), 20)).toEqual({ timedOut: true });
  });

  it("passes the work's failure on", async () => {
    await expect(withDeadline(Promise.reject(new Error("boom")), 500)).rejects.toThrow("boom");
  });

  it("does not leave an unhandled rejection when the work fails after the deadline", async () => {
    const slowFailure = new Promise<string>((_, reject) =>
      setTimeout(() => {
        reject(new Error("late boom"));
      }, 40),
    );

    expect(await withDeadline(slowFailure, 10)).toEqual({ timedOut: true });
    await later(80, null);
  });
});
