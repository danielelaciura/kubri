import { describe, expect, it } from "vitest";
import { MemoryJobQueue } from "../../../src/runtime/memory-queue";

describe("MemoryJobQueue", () => {
  it("records jobs with their options, and whether a transaction was given", async () => {
    const queue = new MemoryJobQueue();

    await queue.enqueue("send-messages", { contactId: "c", senderNumberId: "s" });
    await queue.enqueue(
      "process-contact",
      { contactId: "c", senderNumberId: "s" },
      { startAfterSeconds: 3 },
      {} as never,
    );

    expect(queue.jobs).toEqual([
      {
        name: "send-messages",
        payload: { contactId: "c", senderNumberId: "s" },
        options: {},
        inTransaction: false,
      },
      {
        name: "process-contact",
        payload: { contactId: "c", senderNumberId: "s" },
        options: { startAfterSeconds: 3 },
        inTransaction: true,
      },
    ]);
    expect(queue.named("send-messages")).toHaveLength(1);
  });
});
