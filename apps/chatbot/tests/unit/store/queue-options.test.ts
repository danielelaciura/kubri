import { describe, expect, it } from "vitest";
import { bossOptions, failureOutput } from "../../../src/store/queue";

describe("bossOptions", () => {
  it("gives pg-boss a clean connection string (no Prisma schema parameter)", () => {
    expect(
      bossOptions({
        connectionString: "postgresql://u:p@localhost:5432/db?schema=bot&sslmode=require",
        schema: "bot_queue",
      }),
    ).toEqual({
      connectionString: "postgresql://u:p@localhost:5432/db?sslmode=require",
      schema: "bot_queue",
    });
  });
});

describe("failureOutput", () => {
  it("keeps the error's name and code, never its message (it can carry values)", () => {
    const error = Object.assign(new Error("Unique constraint failed: value mariam@example.com"), {
      name: "PrismaClientKnownRequestError",
      code: "P2002",
    });

    expect(failureOutput(error)).toEqual({ name: "PrismaClientKnownRequestError", code: "P2002" });
  });

  it("has no code when the error has none, and names what is not an Error", () => {
    expect(failureOutput(new TypeError("Via Garibaldi 17"))).toEqual({ name: "TypeError" });
    expect(failureOutput("Via Garibaldi 17")).toEqual({ name: "unknown" });
  });
});
