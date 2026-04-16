export const MATCHER_CONFIG = {
  weights: {
    skills: 0.4,
    description: 0.3,
    location: 0.3,
  },
  displayThreshold: 30,
  fallbackTopN: 10,
  maxResults: 50,
} as const;
