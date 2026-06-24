import type { Dictionary } from "@/lib/i18n";

type AuthErrorKey = keyof Dictionary["authErrors"];

const CODE_TO_KEY: Record<string, AuthErrorKey> = {
  invalid_credentials: "invalidCredentials",
  email_not_confirmed: "emailNotConfirmed",
  over_email_send_rate_limit: "emailRateLimit",
  same_password: "samePassword",
  weak_password: "weakPassword",
  user_already_exists: "userAlreadyExists",
  email_exists: "emailExists",
  otp_expired: "otpExpired",
  otp_disabled: "otpDisabled",
};

export function mapSupabaseError(err: unknown, dictionary: Dictionary): string {
  if (!err || typeof err !== "object") return dictionary.authErrors.generic;
  const code = (err as { code?: string }).code;
  if (code && CODE_TO_KEY[code]) {
    return dictionary.authErrors[CODE_TO_KEY[code]!];
  }
  return dictionary.authErrors.generic;
}
