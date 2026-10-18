/// <reference types="node" />
// Run: node --test apps/mobile/test/*.test.ts (Node 22.18+ strips the types).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cardKey, cardText, cardTimes, KEEP_AFTER_MS, SHOW_BEFORE_MS, type CardInput } from '../src/lib/leaveCardText.ts';

const MIN = 60_000;
const leaveAt = Date.UTC(2026, 9, 19, 4, 14); // 08:14 Tbilisi
// Tbilisi is UTC+4 all year.
const fmt = (ms: number) => new Date(ms + 4 * 3600_000).toISOString().slice(11, 16);

const input: CardInput = {
  tripName: 'Work',
  leaveAt,
  arriveAt: leaveAt + 26 * MIN,
  late: false,
  ride: { mode: 'BUS', line: '539', departAt: leaveAt + 6 * MIN, stop: 'Rustaveli Ave', live: false },
};

test('scheduled 30 min ahead when the window has not started', () => {
  const t = cardTimes(leaveAt, leaveAt - 2 * 3600_000)!;
  assert.equal(t.showAt, leaveAt - SHOW_BEFORE_MS);
  assert.equal(t.showNow, false);
  assert.equal(t.endAt, leaveAt + KEEP_AFTER_MS);
});

test('shown right away inside the window', () => {
  const now = leaveAt - 12 * MIN;
  const t = cardTimes(leaveAt, now)!;
  assert.equal(t.showNow, true);
  assert.equal(t.showAt, now);
});

test('still there in the 10 min after the leave time, gone after', () => {
  assert.ok(cardTimes(leaveAt, leaveAt + 9 * MIN));
  assert.equal(cardTimes(leaveAt, leaveAt + KEEP_AFTER_MS), null);
});

test('text: leave time, ride, stop, arrival', () => {
  const t = cardText(input, fmt);
  assert.equal(t.title, 'Work: Leave at 08:14');
  assert.equal(t.leaveNowTitle, 'Work: Leave now');
  assert.equal(t.body, 'Bus 539 scheduled 08:20 · Rustaveli Ave · arrive 08:40');
});

test('text: live minibus, late, walking-only', () => {
  assert.equal(cardText({ ...input, ride: { ...input.ride!, live: true } }, fmt, true).body, 'Minibus 539 due 08:20 · Rustaveli Ave · arrive 08:40');
  assert.match(cardText({ ...input, late: true }, fmt).body, /arrive 08:40 \(late\)$/);
  assert.equal(cardText({ ...input, ride: null }, fmt).body, 'Walk · arrive 08:40');
  assert.equal(cardText({ ...input, ride: { ...input.ride!, mode: 'SUBWAY', line: 'M1' } }, fmt).body.split(' · ')[0], 'Metro M1 scheduled 08:20');
});

test('key changes with the plan, not with the clock', () => {
  const a = cardKey('t1', input, cardText(input, fmt));
  assert.equal(a, cardKey('t1', input, cardText(input, fmt)));
  const later = { ...input, leaveAt: leaveAt + 4 * MIN };
  assert.notEqual(a, cardKey('t1', later, cardText(later, fmt)));
});
