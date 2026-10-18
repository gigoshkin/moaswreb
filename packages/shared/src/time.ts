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

/**
 * Next Tbilisi wall-clock occurrence of "HH:mm" on one of `days` (ISO
 * weekdays, 1 = Monday) as `YYYY-MM-DDTHH:mm`. Today counts if the time is
 * still ahead. All days when `days` is empty or omitted.
 */
export const nextArriveBy = (time: string, days?: number[], now = Date.now()): string => {
  const [h, m] = time.split(':').map(Number);
  const local = new Date(now + TBILISI_UTC_OFFSET_MIN * 60_000);
  const target = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), h, m));
  if (target.getTime() <= local.getTime()) target.setUTCDate(target.getUTCDate() + 1);
  const allowed = days?.length ? days : [1, 2, 3, 4, 5, 6, 7];
  for (let i = 0; i < 7 && !allowed.includes(target.getUTCDay() || 7); i++) target.setUTCDate(target.getUTCDate() + 1);
  return target.toISOString().slice(0, 16);
};
