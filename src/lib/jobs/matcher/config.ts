export const MATCHER_CONFIG = {
  weights: {
    skills: 0.5,
    description: 0.4,
    location: 0.3,
  },
  displayThreshold: 30,
  fallbackTopN: 10,
  maxResults: 50,
} as const;
