import { describe, expect, it } from "vitest";
import { initialSessionState, type SessionState } from "../../../src/engine/state";
import { nextStatus, savedState } from "../../../src/runtime/process-contact";

const none = { stopped: false, completed: false, needsAttention: false };

describe("nextStatus", () => {
  it("keeps the status when nothing happened", () => {
    expect(nextStatus("active", none)).toBe("active");
    expect(nextStatus("completed", none)).toBe("completed");
  });

  it("does not undo the needs_attention applyEffects already wrote for a flag", () => {
    expect(nextStatus("active", { ...none, needsAttention: true })).toBe("needs_attention");
    expect(nextStatus("needs_attention", none)).toBe("needs_attention");
  });

  it("leaves a completed session completed when a flag arrives", () => {
    expect(nextStatus("completed", { ...none, needsAttention: true })).toBe("completed");
  });

  it("ends stopped when a turn flags and stops", () => {
    expect(nextStatus("active", { ...none, stopped: true, needsAttention: true })).toBe("stopped");
    expect(nextStatus("needs_attention", { ...none, stopped: true })).toBe("stopped");
  });

  it("completes on CompleteSession", () => {
    expect(nextStatus("needs_attention", { ...none, completed: true })).toBe("completed");
  });

  it("never keeps an open status in the closed phase (openKey CHECK)", () => {
    expect(nextStatus("active", none, true)).toBe("stopped");
    expect(nextStatus("needs_attention", none, true)).toBe("stopped");
    expect(nextStatus("completed", none, true)).toBe("completed");
  });
});

describe("savedState", () => {
  const pending: SessionState = {
    ...initialSessionState(),
    phase: "closed",
    pendingConfirmation: { kind: "value", field: "firstName", value: "Mario", confidence: 0.4 },
  };
  const outcome = {
    completed: false,
    stopped: true,
    needsAttention: false,
    language: null,
    outbound: 1,
  };

  it("drops a pending confirmation after a purge (D109)", () => {
    expect(savedState(pending, { ...outcome, purged: true }).pendingConfirmation).toBeNull();
  });

  it("keeps the state as it is without a purge", () => {
    expect(savedState(pending, { ...outcome, purged: false })).toBe(pending);
  });
});
