// Day-of-week WEEKLY digests are sent on, in UTC. 0 = Sunday … 1 = Monday.
export const WEEKLY_SEND_DAY = 1;

// Italian noun phrase for a candidate count, e.g. "1 nuovo candidato" / "3 nuovi candidati".
export function candidatesLabel(n: number): string {
  return n === 1 ? "1 nuovo candidato" : `${n} nuovi candidati`;
}
