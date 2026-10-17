import { TBILISI_UTC_OFFSET_MIN } from '@transit/shared';

/** ms or ISO → "08:12" in Tbilisi time, regardless of the phone's time zone. */
export const hhmm = (t: number | string): string => {
  const d = new Date(new Date(t).getTime() + TBILISI_UTC_OFFSET_MIN * 60_000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};

export const minutes = (sec: number): number => Math.round(sec / 60);
