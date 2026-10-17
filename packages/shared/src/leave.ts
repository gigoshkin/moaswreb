/**
 * Minutes to leave early on top of the walk, so a bus that comes early isn't
 * missed. When you leave home the bus is about `walkMin` away, and TTC's live
 * predictions miss more the further ahead they look (17 Oct measurement: at
 * 6–10 min, 17% of buses came 2+ min early; at 11–15 min, 30%). So the margin
 * is 20% of the walk, 1 to 4 min. A rule of thumb, not a fitted model; see
 * knowledge-base/ttc-prediction-accuracy.md.
 */
export const leaveMarginMin = (walkMin: number): number => Math.min(4, Math.max(1, Math.round(walkMin * 0.2)));

/** When to leave home for a bus departing at `departAtMs`. */
export const leaveAtMs = (departAtMs: number, walkMin: number): number =>
  departAtMs - (walkMin + leaveMarginMin(walkMin)) * 60_000;
