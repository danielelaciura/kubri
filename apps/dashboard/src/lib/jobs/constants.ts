/**
 * LLM score from which a candidate counts as "on target" for an analysis.
 * It is also the lower bound of the light-green band in `ScoreBadge`, so the
 * dashboard KPI and the colors operators see can never diverge.
 */
export const TARGET_MATCH_SCORE = 80;
