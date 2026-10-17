/** Tbilisi is UTC+4 all year (no DST). */
export const TBILISI_UTC_OFFSET_MIN = 240;

/** `2026-10-19T09:00` (Tbilisi wall clock) → `2026-10-19T05:00:00.000Z`. Null if malformed. */
export const tbilisiLocalToIso = (local: string): string | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  const utc = Date.UTC(y, mo - 1, d, h, mi) - TBILISI_UTC_OFFSET_MIN * 60_000;
  const date = new Date(utc);
  // Reject overflow like 2026-02-31 or 25:00.
  const back = new Date(utc + TBILISI_UTC_OFFSET_MIN * 60_000);
  if (back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d || back.getUTCHours() !== h) return null;
  return date.toISOString();
};
