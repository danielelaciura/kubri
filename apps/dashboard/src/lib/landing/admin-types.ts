export type SaveLandingError =
  | "INVALID_POOL"
  | "SLUG_TAKEN"
  | "VALIDATION"
  | "FORBIDDEN"
  | "LOGO_TOO_LARGE"
  | "LOGO_UNSUPPORTED"
  | "LOGO_UPLOAD";

export interface SaveLandingState {
  status: "idle" | "saved" | "error";
  error?: SaveLandingError;
}
