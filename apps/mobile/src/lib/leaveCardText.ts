// Pure rules for the Android "leave card" (see leaveCard.ts): when it shows,
// when it flips to "Leave now", when it goes away, what it says and how far
// the progress bar is.
// No React Native imports, so `node --test` can run it (test/leaveCard.test.ts).

/** The card appears this long before the leave time. */
export const SHOW_BEFORE_MS = 30 * 60_000;
/** After the leave time the "Leave now" card stays this long, then the user has left. */
export const KEEP_AFTER_MS = 10 * 60_000;

/** What the card needs from a chosen plan. */
export interface CardInput {
  tripName: string;
  leaveAt: number;
  arriveAt: number;
  /** First ride; null for a walking-only trip. */
  ride: { mode: string; line: string | null; departAt: number; stop: string | null; live: boolean } | null;
  late: boolean;
}

export interface CardText {
  /** Countdown card title. The chronometer in the header ticks; the title stays put. */
  title: string;
  leaveNowTitle: string;
  /** Ride, stop and arrival, then "08:46 → 08:55" (leave time to arrival) on its own line. */
  body: string;
}

/** Determinate bar over the trip: empty at the leave time, full on arrival. Null when the times don't make a span. */
export function cardProgress(leaveAt: number, arriveAt: number, at: number): { max: number; current: number } | null {
  if (arriveAt <= leaveAt) return null;
  const f = (at - leaveAt) / (arriveAt - leaveAt);
  return { max: 100, current: Math.round(100 * Math.min(1, Math.max(0, f))) };
}

/** Card times for a leave time: show at `showAt` (now, if the window has started), "Leave now" at `leaveAt`, gone at `endAt`. */
export interface CardTimes {
  showAt: number;
  leaveAt: number;
  endAt: number;
  /** True when the countdown part should be posted right away rather than scheduled. */
  showNow: boolean;
}

/** Null when there is nothing to show any more (the user has left). */
export function cardTimes(leaveAt: number, now: number): CardTimes | null {
  const endAt = leaveAt + KEEP_AFTER_MS;
  if (now >= endAt) return null;
  const showAt = leaveAt - SHOW_BEFORE_MS;
  return { showAt: Math.max(showAt, now), leaveAt, endAt, showNow: now >= showAt };
}

const MODE: Record<string, string> = { BUS: 'Bus', SUBWAY: 'Metro', TRAM: 'Tram', GONDOLA: 'Cable car', CABLE_CAR: 'Cable car', RAIL: 'Train' };

/** "Bus 539", "Minibus 306", "Metro M1". */
export const rideName = (r: NonNullable<CardInput['ride']>, minibus = false) =>
  `${minibus ? 'Minibus' : MODE[r.mode] ?? 'Ride'}${r.line ? ` ${r.line}` : ''}`;

/**
 * "Leave at 08:14" / "Leave now" / "Bus 539 scheduled 07:58 · Rustaveli · arrive 08:40".
 * `fmt` turns ms into Tbilisi "HH:mm" (lib/time hhmm), passed in to keep this file import-free.
 */
export function cardText(c: CardInput, fmt: (ms: number) => string, minibus = false): CardText {
  const parts: string[] = [];
  if (c.ride) {
    parts.push(`${rideName(c.ride, minibus)} ${c.ride.live ? 'due' : 'scheduled'} ${fmt(c.ride.departAt)}`);
    if (c.ride.stop) parts.push(c.ride.stop);
  } else {
    parts.push('Walk');
  }
  parts.push(`arrive ${fmt(c.arriveAt)}${c.late ? ' (late)' : ''}`);
  const name = c.tripName ? `${c.tripName}: ` : '';
  return { title: `${name}Leave at ${fmt(c.leaveAt)}`, leaveNowTitle: `${name}Leave now`, body: `${parts.join(' · ')}\n${fmt(c.leaveAt)} → ${fmt(c.arriveAt)}` };
}

/** Same plan, same card: only re-post when this changes, so the card doesn't flicker or buzz again. */
export const cardKey = (tripId: string, c: CardInput, text: CardText) => JSON.stringify([tripId, c.leaveAt, text.title, text.body]);
