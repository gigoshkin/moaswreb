/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Itinerary, PlanQuery, PlanResponse } from '@transit/shared';
import { composePlans, progressivePlan, reuseItineraries } from '../src/lib/progressive.ts';

const query: PlanQuery = { from: { lat: 41.7, lon: 44.7 }, to: { lat: 41.71, lon: 44.8 }, arriveBy: '2026-10-19T09:00' };
const it = (id: string, arriveAt: string): Itinerary =>
  ({ id, departAt: '2026-10-19T04:00:00.000Z', arriveAt, durationSec: 1800, walkSec: 300, walkM: 300, transfers: 0, legs: [] }) as Itinerary;
const plan = (its: Itinerary[], extra: Partial<PlanResponse> = {}): PlanResponse => ({ query, itineraries: its, source: 'ttc', fetchedAt: '2026-10-19T03:00:00.000Z', ...extra });
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));

const a = it('a', '2026-10-19T04:30:00.000Z');
const b = it('b', '2026-10-19T04:40:00.000Z');
const c = it('c', '2026-10-19T04:50:00.000Z');

test('composePlans: full beats cached beats the quick part; partial is flagged only when the quick part shows', () => {
  const quick = plan([a], { partial: true });
  const cached = plan([a, b]);
  const full = plan([a, b, c]);
  assert.deepEqual(composePlans([{}]), { plan: null, partial: false });
  assert.deepEqual(composePlans([{ partial: quick }]), { plan: quick, partial: true });
  // A cached plan stays on screen: the quick part does not swap it for a shorter list.
  assert.deepEqual(composePlans([{ partial: quick, cached }]), { plan: cached, partial: false });
  assert.deepEqual(composePlans([{ partial: quick, cached, full }]), { plan: full, partial: false });
});

test('composePlans: several queries merge, partial while any shows only its quick part', () => {
  const full1 = plan([c]);
  const quick2 = plan([a], { partial: true });
  const r = composePlans([{ full: full1 }, { partial: quick2 }]);
  assert.equal(r.partial, true);
  assert.deepEqual(r.plan!.itineraries.map((i) => i.id), ['a', 'c']);
  assert.equal(composePlans([{ full: full1 }, { full: plan([a]) }]).partial, false);
});

test('reuseItineraries keeps unchanged itineraries as the same objects when the full plan replaces the quick one', () => {
  const quick = plan([a, b], { partial: true });
  const full = plan([copy(a), copy(b), c]);
  const out = reuseItineraries(quick, full)!;
  assert.deepEqual(out.itineraries.map((i) => i.id), ['a', 'b', 'c']);
  assert.equal(out.itineraries[0], a);
  assert.equal(out.itineraries[1], b);
  assert.equal(out.itineraries[2], full.itineraries[2]);
  assert.equal(out.partial, undefined);
});

test('reuseItineraries replaces a changed itinerary and passes through null and identical plans', () => {
  const moved = { ...a, arriveAt: '2026-10-19T04:35:00.000Z' };
  const out = reuseItineraries(plan([a]), plan([moved]))!;
  assert.equal(out.itineraries[0], moved);
  assert.equal(reuseItineraries(null, plan([a]))!.itineraries[0], a);
  assert.equal(reuseItineraries(plan([a]), null), null);
  const p = plan([a, b]);
  assert.equal(reuseItineraries(p, plan([copy(a), copy(b)])), p);
});

const later = <T>(ms: number, v: T) => new Promise<T>((r) => setTimeout(() => r(v), ms));
const failLater = (ms: number) => new Promise<never>((_, rej) => setTimeout(() => rej(new Error('boom')), ms));

test('progressivePlan: the quick part is delivered first, the full plan is the result', async () => {
  const seen: PlanResponse[] = [];
  const quick = plan([a], { partial: true });
  const full = plan([a, b]);
  const out = await progressivePlan(() => later(5, quick), () => later(40, full), (p) => seen.push(p));
  assert.equal(out, full);
  assert.deepEqual(seen, [quick]);
});

test('progressivePlan: a quick part arriving after the full plan is dropped', async () => {
  const seen: PlanResponse[] = [];
  const full = plan([a, b]);
  const out = await progressivePlan(() => later(40, plan([a], { partial: true })), () => later(5, full), (p) => seen.push(p));
  assert.equal(out, full);
  await later(60, 0);
  assert.deepEqual(seen, []);
});

test('progressivePlan: an old server answers the quick request in full; that is the result at once', async () => {
  const seen: PlanResponse[] = [];
  const whole = plan([a, b]);
  const t = Date.now();
  const out = await progressivePlan(() => later(5, whole), () => later(300, plan([a, b, c])), (p) => seen.push(p));
  assert.equal(out, whole);
  assert.deepEqual(seen, []);
  assert.ok(Date.now() - t < 200);
});

test('progressivePlan: a failed quick request does not break the full one', async () => {
  const full = plan([a]);
  assert.equal(await progressivePlan(() => failLater(5), () => later(20, full), () => assert.fail('no partial')), full);
});

test('progressivePlan: a failed full plan still delivers the quick part first, then rejects', async () => {
  const seen: PlanResponse[] = [];
  const quick = plan([a], { partial: true });
  await assert.rejects(progressivePlan(() => later(30, quick), () => failLater(5), (p) => seen.push(p)), /boom/);
  assert.deepEqual(seen, [quick]);
});

test('progressivePlan: both failing rejects with the full request error', async () => {
  await assert.rejects(progressivePlan(() => failLater(5), () => failLater(10), () => {}), /boom/);
});
