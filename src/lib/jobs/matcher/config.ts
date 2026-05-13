export const MATCHER_CONFIG = {
  weights: {
    semantic: 0.7,
    location: 0.3,
  },
  displayThreshold: 25,
  fallbackTopN: 10,
  maxResults: 50,
  candidatePoolFetchSize: 200,
} as const;
