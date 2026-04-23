const MESSAGES: Record<string, string> = {
  invalid_credentials: "Email o password non validi",
  email_not_confirmed: "Devi completare l'invito via email prima di accedere",
  over_email_send_rate_limit: "Troppi tentativi, riprova tra qualche minuto",
  same_password: "La nuova password deve essere diversa dalla precedente",
  weak_password:
    "La password non rispetta i requisiti minimi (8 caratteri, lettere e numeri)",
  user_already_exists: "Un utente con questa email esiste già",
  email_exists: "Un utente con questa email esiste già",
  otp_expired: "Il link è scaduto, richiedine uno nuovo",
  otp_disabled: "Il link non è più valido, richiedine uno nuovo",
};

const GENERIC = "Si è verificato un errore, riprova";

export function mapSupabaseError(err: unknown): string {
  if (!err || typeof err !== "object") return GENERIC;
  const code = (err as { code?: string }).code;
  if (code && MESSAGES[code]) return MESSAGES[code];
  return GENERIC;
}
