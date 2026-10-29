import { describe, expect, it } from "vitest";
import { bossOptions } from "../../../src/store/queue";

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
