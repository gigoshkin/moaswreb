/// <reference types="node" />
// Run: node --test apps/mobile/test/*.test.ts (Node 22.18+ strips the types).
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import type { Itinerary, PlanLeg } from '@transit/shared';

// The app imports its own files without an extension (Metro resolves them); let Node do the same here.
registerHooks({
  resolve: (spec, ctx, next) => {
    try {
      return next(spec, ctx);
    } catch (e) {
      if (spec.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(spec)) return next(`${spec}.ts`, ctx);
      throw e;
    }
  },
});
const { findSwitch, liveStatus, liveView, LIVE_EVERY_MS, LIVE_STALE_MS, nextLookIn, nextWatch, shouldAlert, viewChanged } = await import('../src/lib/leaveCardLive.ts');
const { leaveAt } = await import('../src/lib/plans.ts');

const MIN = 60_000;
const t0 = Date.UTC(2026, 9, 19, 4, 0); // 08:00 Tbilisi
const iso = (min: number) => new Date(t0 + min * MIN).toISOString();
// Tbilisi is UTC+4 all year.
const fmt = (ms: number) => new Date(ms + 4 * 3600_000).toISOString().slice(11, 16);

const place = { name: 'x', lat: 41.7, lon: 44.7, stopId: null };
const leg = (mode: string, dep: number, arr: number, line?: string, realtime = false): PlanLeg =>
  ({ mode, from: place, to: place, departAt: iso(dep), arriveAt: iso(arr), durationSec: (arr - dep) * 60, distanceM: 0, route: line ? { shortName: line, longName: null, color: null } : null, headsign: null, realtime, intermediateStops: 0, polyline: null }) as PlanLeg;
/** 5 min walk, then the line from `dep` to `arr`. */
const ride = (line: string, dep: number, arr: number, realtime = false): Itinerary => ({
  id: `${line}-${dep}`, departAt: iso(dep - 5), arriveAt: iso(arr), durationSec: (arr - dep + 5) * 60, walkSec: 300, walkM: 400, transfers: 0,
  legs: [leg('WALK', dep - 5, dep), leg('BUS', dep, arr, line, realtime)],
});

test('watch: kept for the same run or a late one, replaced by another line or a new run', () => {
  const w = { line: '539', departAt: t0 + 20 * MIN };
  assert.deepEqual(nextWatch(null, { line: '539', departAt: t0 + 20 * MIN }, t0), w);
  assert.equal(nextWatch(w, { line: '539', departAt: t0 + 25 * MIN }, t0), w, 'five min late is still the same run');
  assert.equal(nextWatch(w, { line: '17', departAt: t0 + 22 * MIN }, t0), w, 'another line does not replace it before the ride has gone');
  assert.deepEqual(nextWatch(w, { line: '17', departAt: t0 + 22 * MIN }, t0 + 60 * MIN), { line: '17', departAt: t0 + 22 * MIN }, 'after that it does');
  assert.equal(nextWatch(null, { line: null, departAt: t0 }, t0), null);
  assert.equal(nextWatch(null, null, t0), null);
});

const watch = { line: '539', departAt: t0 + 20 * MIN };
const now = t0 + 10 * MIN;

test('switch: planned line 5 min late, another leaves soon and arrives 8 min earlier', () => {
  const its = [ride('539', 25, 60, true), ride('17', 22, 52)];
  const sw = findSwitch(its, watch, now, 0)!;
  assert.equal(sw.fromLine, '539');
  assert.equal(sw.toLine, '17');
  assert.equal(sw.lateMin, 5);
  assert.equal(sw.leaveAt, leaveAt(its[1], 0));
  assert.equal(sw.arriveAt, t0 + 52 * MIN);
});

test('switch: no delay, not live data, a huge gap, a small gain or a far-off leave time mean no switch', () => {
  const alt = ride('17', 22, 52);
  assert.equal(findSwitch([ride('539', 22, 60, true), alt], watch, now, 0), null, 'two min late is not late');
  assert.equal(findSwitch([ride('539', 25, 60, false), alt], watch, now, 0), null, 'a timetable time is not a delay');
  assert.equal(findSwitch([ride('539', 55, 90, true), alt], watch, now, 0), null, 'a 35 min gap is another run');
  assert.equal(findSwitch([ride('539', 25, 60, true), ride('17', 22, 58)], watch, now, 0), null, 'arriving only 2 min earlier');
  assert.equal(findSwitch([ride('539', 25, 60, true), ride('17', 45, 52)], watch, now, 0), null, 'leaves in 34 min');
  assert.equal(findSwitch([ride('539', 25, 60, true), alt], watch, now + 8 * MIN, 0), null, 'its leave time has gone by');
});

test('switch: the buffer moves the other line\'s leave time', () => {
  const its = [ride('539', 25, 60, true), ride('17', 31, 52)];
  assert.equal(findSwitch(its, watch, now, 0), null, 'leaves in 15 min: too far off');
  assert.equal(findSwitch(its, watch, now + 6 * MIN, 0)!.leaveAt, leaveAt(its[1], 0));
  assert.equal(findSwitch(its, watch, now + 6 * MIN, 5)!.leaveAt, leaveAt(its[1], 5));
});

const input = { tripName: 'Work', leaveAt: t0 + 14 * MIN, arriveAt: t0 + 40 * MIN, late: false, ride: { mode: 'BUS', line: '539', departAt: t0 + 20 * MIN, stop: 'Rustaveli Ave', live: true } };

test('view: countdown before the leave time, "Leave now" with the bar after', () => {
  const before = liveView(input, false, null, t0 + 5 * MIN, fmt);
  assert.equal(before.title, 'Work: Leave at 08:14');
  assert.equal(before.leaving, false);
  assert.equal(before.progress, 0);
  const after = liveView(input, false, null, t0 + 27 * MIN, fmt);
  assert.equal(after.title, 'Work: Leave now');
  assert.equal(after.leaving, true);
  assert.equal(after.progress, 50);
  assert.equal(after.body, 'Bus 539 due 08:20 · Rustaveli Ave · arrive 08:40\n08:14 → 08:40');
});

test('view: a switch names both lines and counts down to the other line', () => {
  const sw = { fromLine: '539', toLine: '17', lateMin: 5, leaveAt: t0 + 16 * MIN, arriveAt: t0 + 52 * MIN };
  const soon = liveView(input, false, sw, t0 + 10 * MIN, fmt);
  assert.equal(soon.title, 'Work: Leave at 08:16 · switch to 17');
  assert.equal(soon.body, '539 is 5 min late. 17 gets you there by 08:52.\n08:16 → 08:52');
  assert.equal(soon.leaveAt, sw.leaveAt);
  assert.equal(soon.leaving, false);
  const now = liveView(input, false, sw, t0 + 15.5 * MIN, fmt);
  assert.equal(now.title, 'Work: Leave now · switch to 17');
  assert.equal(now.leaving, false, 'still counting down, to the other line\'s leave time');
  assert.equal(liveView({ ...input, tripName: '' }, false, sw, t0 + 16 * MIN, fmt).title, 'Leave now · switch to 17');
});

test('re-post only when something visible changed; buzz only when it is time to leave', () => {
  const a = liveView(input, false, null, t0 + 5 * MIN, fmt);
  assert.equal(viewChanged(null, a), true);
  assert.equal(viewChanged(a, liveView(input, false, null, t0 + 5.5 * MIN, fmt)), false, 'same text, same bar');
  assert.equal(viewChanged(a, liveView({ ...input, leaveAt: input.leaveAt + 4 * MIN }, false, null, t0 + 5 * MIN, fmt)), true, 'leave time moved');
  const b = liveView(input, false, null, t0 + 20 * MIN, fmt);
  const c = liveView(input, false, null, t0 + 22 * MIN, fmt);
  assert.equal(viewChanged(b, c), true, 'the bar moved');
  assert.equal(shouldAlert(a, b), true, 'flipped to leave now');
  assert.equal(shouldAlert(b, c), false);
  assert.equal(shouldAlert(null, b), false, 'the first post is the trigger\'s');
});

test('service status: running while it reports, stale when it went quiet, idle when it ended', () => {
  const rec = { trip: 't1', date: '2026-10-19', beat: t0 };
  assert.equal(liveStatus(null, t0), 'idle');
  assert.equal(liveStatus(rec, t0 + LIVE_EVERY_MS), 'running');
  assert.equal(liveStatus(rec, t0 + LIVE_STALE_MS), 'stale');
  assert.equal(liveStatus({ ...rec, ended: 'dismissed' }, t0 + LIVE_STALE_MS), 'idle');
});

test('next look: the usual interval, shortened to land on the leave time or the end', () => {
  assert.equal(nextLookIn(t0, t0 + 20 * MIN, t0 + 30 * MIN), LIVE_EVERY_MS);
  assert.equal(nextLookIn(t0, t0 + 12_000, t0 + 30 * MIN), 12_000);
  assert.equal(nextLookIn(t0, t0 - MIN, t0 + 5_000), 5_000, 'past the leave time, only the end counts');
  assert.equal(nextLookIn(t0, t0 + 100, t0 + 30 * MIN), 1_000, 'never a busy loop');
});
