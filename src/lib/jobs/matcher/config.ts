export const MATCHER_CONFIG = {
  /**
   * Location is now a hard pre-filter (see `locationFilter` below): candidates
   * outside the JD's search radius are excluded, not penalized. The final
   * score is therefore 100% semantic.
   */
  weights: {
    semantic: 1.0,
    location: 0.0,
  },
  /**
   * Pre-filter candidates by Haversine distance against the JD's
   * `searchRadiusKm`. Candidates without coordinates and JDs whose
   * municipality can't be resolved fall through (no filter applied).
   */
  locationFilter: {
    enabled: true,
  },
  /**
   * Optional linear remap of semantic scores from [floor, 1] → [0, 1].
   * Useful with older small models (gte-small) whose cosine values are
   * compressed; with mistral-embed (1024-dim) values already spread
   * across [0.7, 0.95], so we keep it off by default.
   */
  semanticRescale: {
    enabled: false,
    floor: 0.5,
  },
  displayThreshold: 25,
  fallbackTopN: 10,
  maxResults: 50,
  candidatePoolFetchSize: 200,
} as const;
