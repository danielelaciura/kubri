import { InvalidArgumentError } from "commander";
import { describe, expect, it } from "vitest";
import { parseHistory } from "../../../../src/cli/commands/simulate";

describe("simulate --history", () => {
  it.each([
    ["0", 0],
    ["3", 3],
    ["10", 10],
  ])("accepts %j", (value, size) => {
    expect(parseHistory(value)).toBe(size);
  });

  it.each(["11", "-1", "2.5", "tre"])(
    "refuses %j: same bound as NLU_HISTORY_MESSAGES (0–10)",
    (value) => {
      expect(() => parseHistory(value)).toThrow(InvalidArgumentError);
      expect(() => parseHistory(value)).toThrow("must be a whole number from 0 to 10");
    },
  );
});
