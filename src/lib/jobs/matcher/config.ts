export const MATCHER_CONFIG = {
  weights: {
    semantic: 0.8,
    location: 0.2,
  },
  /**
   * Cosine similarity from gte-small for related Italian texts typically
   * clusters in [0.5, 0.9]. Linearly remap that band to [0, 1] so the
   * effective discrimination range is amplified before weighting.
   */
  semanticRescale: {
    enabled: true,
    floor: 0.5,
  },
  displayThreshold: 25,
  fallbackTopN: 10,
  maxResults: 50,
  candidatePoolFetchSize: 200,
} as const;
