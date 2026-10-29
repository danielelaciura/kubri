import { describe, expect, it } from "vitest";
import { debounceWaitMs } from "../../../src/runtime/debounce";

const CONFIG = { debounceMs: 3000, debounceMaxWaitMs: 10_000 };
const T0 = new Date("2026-10-24T10:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const msg = (offsetMs: number) => ({ createdAt: at(offsetMs) });

describe("debounceWaitMs (D106)", () => {
  it("does not wait when the debounce is off", () => {
    expect(debounceWaitMs({ ...CONFIG, debounceMs: 0 }, [msg(0)], at(0))).toBe(0);
  });

  it("does not wait with no messages", () => {
    expect(debounceWaitMs(CONFIG, [], at(0))).toBe(0);
  });

  it("waits for the rest of the quiet time after the last message", () => {
    expect(debounceWaitMs(CONFIG, [msg(0), msg(1000)], at(1500))).toBe(2500);
  });

  it("does not depend on the order of the burst", () => {
    expect(debounceWaitMs(CONFIG, [msg(1000), msg(0)], at(1500))).toBe(2500);
  });

  it("goes ahead once the person has been quiet long enough", () => {
    expect(debounceWaitMs(CONFIG, [msg(0)], at(3000))).toBe(0);
    expect(debounceWaitMs(CONFIG, [msg(0)], at(9000))).toBe(0);
  });

  it("never holds a burst past the maximum wait", () => {
    // Messages keep coming every second or two; at 9.6 s the first is nearly 10 s old.
    const burst = [0, 2000, 4000, 6000, 8000, 9500].map(msg);

    expect(debounceWaitMs(CONFIG, burst, at(9600))).toBe(400);
    expect(debounceWaitMs(CONFIG, burst, at(10_000))).toBe(0);
  });

  it("adds the skew of a worker clock behind the database", () => {
    expect(debounceWaitMs(CONFIG, [msg(1000)], at(500))).toBe(3500);
  });
});
