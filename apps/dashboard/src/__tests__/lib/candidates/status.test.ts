import { describe, it, expect } from "vitest";
import {
  CANDIDATE_STATUSES,
  DEFAULT_CANDIDATE_STATUS,
  filterByStatus,
  isCandidateStatus,
  resolveStatus,
} from "@/lib/candidates/status";

describe("candidate status helpers", () => {
  it("lists the statuses in journey order, starting from NEW", () => {
    expect(CANDIDATE_STATUSES).toEqual([
      "NEW",
      "SCREENING",
      "CONTACTED",
      "INTERVIEW",
      "OFFER",
      "HIRED",
      "REJECTED",
      "WITHDRAWN",
    ]);
    expect(DEFAULT_CANDIDATE_STATUS).toBe("NEW");
  });

  it("resolveStatus defaults to NEW when the org has no row", () => {
    expect(resolveStatus({ c1: "HIRED" }, "c1")).toBe("HIRED");
    expect(resolveStatus({ c1: "HIRED" }, "c2")).toBe("NEW");
  });

  it("isCandidateStatus accepts only known values", () => {
    expect(isCandidateStatus("OFFER")).toBe(true);
    expect(isCandidateStatus("offer")).toBe(false);
    expect(isCandidateStatus(undefined)).toBe(false);
  });

  describe("filterByStatus", () => {
    const candidates = [{ id: "c1" }, { id: "c2" }, { id: "c3" }];
    const map = { c1: "INTERVIEW", c2: "NEW" } as const;

    it("returns everything when no status is requested", () => {
      expect(filterByStatus(candidates, map, undefined)).toEqual(candidates);
    });

    it("NEW includes candidates with no row", () => {
      expect(filterByStatus(candidates, map, "NEW").map((c) => c.id)).toEqual([
        "c2",
        "c3",
      ]);
    });

    it("other statuses match exactly", () => {
      expect(
        filterByStatus(candidates, map, "INTERVIEW").map((c) => c.id),
      ).toEqual(["c1"]);
      expect(filterByStatus(candidates, map, "HIRED")).toEqual([]);
    });
  });
});
