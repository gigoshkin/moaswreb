import type { Itinerary } from '@transit/shared';
import { cardProgress, cardText, type CardInput } from './leaveCardText';
import { leaveAt, transitLegs } from './plans';

// Pure rules for the live leave card (leaveCard.ts runs it as a foreground
// service): which delay counts, when another line is worth a "switch to", what
// the card shows at a given moment, and when it has to be re-posted. The delay
// and switch rules are the server watcher's (apps/server/src/alerts/watcher.ts),
// so the card and the push agree.
// No React Native imports, so `node --test` can run it (test/leaveCardLive.test.ts).

/** How often the running card looks at the plan again (and moves the progress bar). */
export const LIVE_EVERY_MS = 30_000;
/** Plans are fetched at most this often while the card runs; between fetches the cached plan is used. */
export const LIVE_FETCH_EVERY_MS = 60_000;
/** The static fallback card is posted this long after the live one was due, unless the service has taken over by then. */
export const FALLBACK_AFTER_MS = 60_000;
/** A running card that hasn't reported for this long is taken for dead. */
export const LIVE_STALE_MS = 3 * 60_000;

const LATE_MIN = 3; // the planned line's next ride this much later than first seen counts as late
const LATE_MAX_MIN = 30; // a bigger gap is another run of the line, not a delay
const SWITCH_MIN = 3; // another line has to arrive this much earlier to be worth it
const SWITCH_WITHIN_MIN = 10; // ...and leave within this long

/** The first ride of the plan and when it first showed up, to measure a delay against. */
export interface Watch {
  line: string;
  departAt: number;
}

/**
 * The watch to keep after seeing `ride` as the plan's first ride: the same one
 * while it is still the same run (or a late one of the same line, or until it
 * would have left), else the new ride.
 */
export function nextWatch(prev: Watch | null | undefined, ride: { line: string | null; departAt: number } | null, now: number): Watch | null {
  const same = prev && ride && prev.line === ride.line && ride.departAt >= prev.departAt - 60_000 && ride.departAt - prev.departAt <= LATE_MAX_MIN * 60_000;
  if (same || (prev && prev.departAt + LATE_MAX_MIN * 60_000 > now)) return prev ?? null;
  return ride?.line ? { line: ride.line, departAt: ride.departAt } : null;
}

export interface Switch {
  fromLine: string;
  toLine: string;
  lateMin: number;
  /** When to leave for the other line, and when it arrives. */
  leaveAt: number;
  arriveAt: number;
}

const firstRide = (it: Itinerary) => transitLegs(it)[0];

/**
 * The watched line's next ride is running late on live data and another line,
 * leaving within 10 min, arrives 3+ min earlier. The delay is measured against
 * the departure first seen (TTC's own delay field is not trusted).
 */
export function findSwitch(its: Itinerary[], watch: Watch, now: number, bufferMin: number): Switch | null {
  const late = its
    .filter((it) => firstRide(it)?.route?.shortName === watch.line && Date.parse(firstRide(it)!.departAt) >= watch.departAt - 60_000)
    .sort((a, b) => Date.parse(firstRide(a)!.departAt) - Date.parse(firstRide(b)!.departAt))[0];
  if (!late || !firstRide(late)!.realtime) return null;
  const lateMin = Math.round((Date.parse(firstRide(late)!.departAt) - watch.departAt) / 60_000);
  if (lateMin < LATE_MIN || lateMin > LATE_MAX_MIN) return null;
  const lateArrive = Date.parse(late.arriveAt);
  const alt = its
    .filter((it) => {
      const line = firstRide(it)?.route?.shortName;
      const leave = leaveAt(it, bufferMin);
      return line && line !== watch.line && leave >= now - 60_000 && leave <= now + SWITCH_WITHIN_MIN * 60_000 && Date.parse(it.arriveAt) <= lateArrive - SWITCH_MIN * 60_000;
    })
    .sort((a, b) => Date.parse(a.arriveAt) - Date.parse(b.arriveAt))[0];
  if (!alt) return null;
  return { fromLine: watch.line, toLine: firstRide(alt)!.route!.shortName, lateMin, leaveAt: leaveAt(alt, bufferMin), arriveAt: Date.parse(alt.arriveAt) };
}

/** What the live card shows at one moment. */
export interface LiveView {
  /** Chronometer base: counts down to it, then up from it. */
  leaveAt: number;
  arriveAt: number;
  title: string;
  body: string;
  /** The leave time has come. */
  leaving: boolean;
  /** Progress bar, percent; null when the times make no span. */
  progress: number | null;
}

/**
 * The card for a plan (or the switch that replaces it) at `now`. A switch says
 * "Leave now · switch to 17" from a minute before its leave time on, and counts
 * down to the other line's leave time.
 */
export function liveView(c: CardInput, minibus: boolean, sw: Switch | null, now: number, fmt: (ms: number) => string): LiveView {
  const name = c.tripName ? `${c.tripName}: ` : '';
  let at = c.leaveAt;
  let arrive = c.arriveAt;
  let title: string;
  let body: string;
  if (sw) {
    at = sw.leaveAt;
    arrive = sw.arriveAt;
    title = `${name}${sw.leaveAt - now > 60_000 ? `Leave at ${fmt(sw.leaveAt)}` : 'Leave now'} · switch to ${sw.toLine}`;
    body = `${sw.fromLine} is ${sw.lateMin} min late. ${sw.toLine} gets you there by ${fmt(sw.arriveAt)}.\n${fmt(sw.leaveAt)} → ${fmt(sw.arriveAt)}`;
  } else {
    const t = cardText(c, fmt, minibus);
    title = now >= c.leaveAt ? t.leaveNowTitle : t.title;
    body = t.body;
  }
  return { leaveAt: at, arriveAt: arrive, title, body, leaving: now >= at, progress: cardProgress(at, arrive, now)?.current ?? null };
}

/** Re-post only when something visible changed, so the card neither flickers nor wakes the screen for nothing. */
export const viewChanged = (prev: LiveView | null, next: LiveView): boolean =>
  !prev || prev.title !== next.title || prev.body !== next.body || prev.leaveAt !== next.leaveAt || prev.leaving !== next.leaving || prev.progress !== next.progress;

/** The leave-now moment is the one update that may buzz. */
export const shouldAlert = (prev: LiveView | null, next: LiveView): boolean => Boolean(prev && next.leaving && !prev.leaving);

/** What the service wrote last, for the app (leaveCard.ts sync) to read. */
export interface LiveRecord {
  trip: string;
  date: string;
  /** Last time the service looked. */
  beat: number;
  /** Set when the service is done: it ran out, the user swiped the card away, or the card was cancelled. */
  ended?: 'finished' | 'dismissed' | 'cancelled';
}

/**
 * `running`: the service reported lately, leave the card to it. `stale`: it
 * stopped reporting without saying it ended (killed), so the card should be
 * posted again. `idle`: no service, or it ended.
 */
export function liveStatus(rec: LiveRecord | null | undefined, now: number): 'running' | 'stale' | 'idle' {
  if (!rec || rec.ended) return 'idle';
  return now - rec.beat < LIVE_STALE_MS ? 'running' : 'stale';
}

/** Ms to sleep until the next look: the usual interval, cut short to land on the leave time or the end. */
export function nextLookIn(now: number, leaveAt: number, endAt: number): number {
  const edges = [leaveAt - now, endAt - now].filter((d) => d > 0);
  return Math.max(1_000, Math.min(LIVE_EVERY_MS, ...edges));
}
