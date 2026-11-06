/**
 * D143: the dashboard's WhatsApp links and QR codes prefill the first message as
 * "[<pool key>] <text>", as Make's bot expected. The slug in square brackets picks the
 * campaign; a keyword written alone still works.
 */
const BRACKETED = /\[\s*([^[\]\s][^[\]]{0,63}?)\s*\]/;
const LEADING_BRACKETED = /^\s*\[[^[\]]{1,64}\]\s*/;

const normalize = (text: string): string => text.trim().toLowerCase();

/** The keywords a message may route on, in order: the bracketed slug, then the whole message. */
export function routeKeywords(text: string): string[] {
  const whole = normalize(text);
  const slug = BRACKETED.exec(text)?.[1];
  const bracketed = slug === undefined ? null : normalize(slug);
  return bracketed && bracketed !== whole ? [bracketed, whole] : [whole];
}

/** The message without its leading routing slug: the NLU reads only what the candidate wrote. */
export function stripRouteToken(text: string): string {
  const stripped = text.replace(LEADING_BRACKETED, "");
  return stripped.trim() === "" ? text : stripped;
}
