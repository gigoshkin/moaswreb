import { TBILISI_UTC_OFFSET_MIN } from '@transit/shared';

/** ms or ISO → "08:12" in Tbilisi time, regardless of the phone's time zone. */
export const hhmm = (t: number | string): string => {
  const d = new Date(new Date(t).getTime() + TBILISI_UTC_OFFSET_MIN * 60_000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};

export const minutes = (sec: number): number => Math.round(sec / 60);

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
