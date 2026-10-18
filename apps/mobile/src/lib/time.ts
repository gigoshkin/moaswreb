import { TBILISI_UTC_OFFSET_MIN } from '@transit/shared';

export { nextArriveBy } from '@transit/shared';

/** ms or ISO → "08:12" in Tbilisi time, regardless of the phone's time zone. */
export const hhmm = (t: number | string): string => {
  const d = new Date(new Date(t).getTime() + TBILISI_UTC_OFFSET_MIN * 60_000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};

export const minutes = (sec: number): number => Math.round(sec / 60);


// --- Tbilisi calendar days (`YYYY-MM-DD`), independent of the phone's time zone ---

const local = (ms: number) => new Date(ms + TBILISI_UTC_OFFSET_MIN * 60_000);

/** Today's Tbilisi date, `YYYY-MM-DD`. */
export const todayLocal = (now = Date.now()): string => local(now).toISOString().slice(0, 10);

export const addDays = (date: string, n: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** ISO weekday of a `YYYY-MM-DD`, 1 = Monday. */
export const isoWeekday = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay() || 7;

export const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_SHORT = MONTH_LONG.map((m) => m.slice(0, 3));

const parts = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  return { wd: (d.getUTCDay() + 6) % 7, day: d.getUTCDate(), month: d.getUTCMonth() };
};

/** "Mon, 19 October" */
export const longDate = (date: string): string => {
  const p = parts(date);
  return `${DAY_SHORT[p.wd]}, ${p.day} ${MONTH_LONG[p.month]}`;
};

/** "Today", "Tomorrow", or "Wed 21 Oct". */
export const relativeDay = (date: string, now = Date.now()): string => {
  const today = todayLocal(now);
  if (date === today) return 'Today';
  if (date === addDays(today, 1)) return 'Tomorrow';
  const p = parts(date);
  return `${DAY_SHORT[p.wd]} ${p.day} ${MONTH_SHORT[p.month]}`;
};

export const weekdayName = (date: string): string => DAY_LONG[parts(date).wd];

/** "Mon, Wed" or "Mon–Fri" or "Every day". */
export const daysText = (days: number[]): string => {
  const d = [...new Set(days)].sort((a, b) => a - b);
  if (d.length === 7) return 'Every day';
  if (d.length > 2 && d.every((x, i) => i === 0 || x === d[i - 1] + 1)) return `${DAY_SHORT[d[0] - 1]}–${DAY_SHORT[d.at(-1)! - 1]}`;
  return d.map((x) => DAY_SHORT[x - 1]).join(', ');
};
