import { WEEKLY_SEND_DAY } from "./config";

export function isWeeklyDue(now: Date): boolean {
  return now.getUTCDay() === WEEKLY_SEND_DAY;
}
