import { describe, it, expect } from "vitest";
import { buildListNamesByCandidate } from "@/lib/lists/service";

describe("buildListNamesByCandidate", () => {
  it("maps each candidate to the names of its lists", () => {
    const lists = [
      { id: "l1", name: "Camerieri" },
      { id: "l2", name: "Palermo" },
    ];
    const memberships = [
      { listId: "l1", candidateId: "c1" },
      { listId: "l2", candidateId: "c1" },
      { listId: "l1", candidateId: "c2" },
    ];
    const map = buildListNamesByCandidate(lists, memberships);
    expect(map["c1"]).toEqual(["Camerieri", "Palermo"]);
    expect(map["c2"]).toEqual(["Camerieri"]);
    expect(map["c3"]).toBeUndefined();
  });

  it("returns an empty object when there are no memberships", () => {
    expect(buildListNamesByCandidate([{ id: "l1", name: "X" }], [])).toEqual({});
  });
});
