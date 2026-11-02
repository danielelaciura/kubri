export type SaveLandingError = "INVALID_POOL" | "SLUG_TAKEN" | "VALIDATION" | "FORBIDDEN";

export interface SaveLandingState {
  status: "idle" | "saved" | "error";
  error?: SaveLandingError;
}
