import type { Itinerary, PlanLeg, PlanResponse } from '@transit/shared';

// SYNTHETIC preview data for the component kit, built relative to "now" so the
// leave-by bar moves. Stops and colours are illustrative, not TTC data.

const leg = (mode: string, short: string | null, color: string | null, start: number, min: number): PlanLeg => ({
  mode,
  from: { name: '', lat: 41.71, lon: 44.79, stopId: null },
  to: { name: '', lat: 41.71, lon: 44.79, stopId: null },
  departAt: new Date(start).toISOString(),
  arriveAt: new Date(start + min * 60_000).toISOString(),
  durationSec: min * 60,
  distanceM: mode === 'WALK' ? min * 80 : min * 400,
  route: short ? { shortName: short, longName: null, color } : null,
  headsign: null,
  realtime: false,
  intermediateStops: 0,
  polyline: null,
});

const itinerary = (id: string, start: number, legs: [string, string | null, string | null, number][]): Itinerary => {
  let t = start;
  const built = legs.map(([mode, short, color, min]) => {
    const l = leg(mode, short, color, t, min);
    t += min * 60_000;
    return l;
  });
  const walks = built.filter((l) => l.mode === 'WALK');
  return {
    id,
    departAt: new Date(start).toISOString(),
    arriveAt: new Date(t).toISOString(),
    durationSec: (t - start) / 1000,
    walkSec: walks.reduce((s, l) => s + l.durationSec, 0),
    walkM: walks.reduce((s, l) => s + l.distanceM, 0),
    transfers: built.length - walks.length - 1,
    legs: built,
  };
};

export const samplePlan = (now = Date.now()): PlanResponse => {
  const m = 60_000;
  return {
    query: { from: { lat: 41.7151, lon: 44.8271 }, to: { lat: 41.7099, lon: 44.7929 }, arriveBy: '' },
    source: 'ttc',
    fetchedAt: new Date(now).toISOString(),
    itineraries: [
      itinerary('a', now + 7 * m, [['WALK', null, null, 5], ['BUS', '306', '#E02B2B', 20], ['BUS', '347', '#1E88E5', 12], ['WALK', null, null, 4]]),
      itinerary('b', now + 3 * m, [['WALK', null, null, 7], ['SUBWAY', 'M1', null, 18], ['BUS', '558', '#FBC02D', 14], ['WALK', null, null, 3]]),
      itinerary('c', now + 12 * m, [['WALK', null, null, 3], ['BUS', '61', '#43A047', 31], ['WALK', null, null, 6]]),
    ],
  };
};
