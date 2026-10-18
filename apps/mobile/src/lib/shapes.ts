import type { Itinerary } from '@transit/shared';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { stopShape } from './api';
import { readCache, writeCache } from './cache';

/**
 * Road shapes for rides, looked up once per ride (line + boarding stop + get-off stop) and kept on the phone for good.
 * Until a shape is there, or when TTC has none, the ride is drawn as straight lines between its stops.
 */
const mem = new Map<string, string | null>();
const asked = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

const keyOf = (route: string, from: string, to: string) => `${route}|${from}|${to}`;
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
const bump = () => {
  version++;
  listeners.forEach((l) => l());
};

function lookup(key: string): string | null {
  if (mem.has(key)) return mem.get(key)!;
  const saved = readCache<string>(`shape:${key}`);
  if (saved) mem.set(key, saved);
  return saved;
}

/** At most this many shape lookups at a time (each is a planner call upstream); the rest wait their turn. */
const PARALLEL = 3;
const queue: { key: string; run: () => Promise<void> }[] = [];
let running = 0;
function pump() {
  while (running < PARALLEL && queue.length) {
    const job = queue.shift()!;
    running++;
    job.run().finally(() => {
      running--;
      pump();
    });
  }
}

/**
 * Ask the server for a ride's shape unless this session already did (a miss is retried next launch).
 * `first`: ahead of the queue (a ride on the map now), else after what is already waiting.
 */
function ensure(route: string, from: string, to: string, first = true) {
  const key = keyOf(route, from, to);
  if (lookup(key) || asked.has(key)) return;
  asked.add(key);
  const job = {
    key,
    run: () =>
      stopShape(from, to, route).then(
        (r) => {
          if (!r.shape) return;
          mem.set(key, r.shape);
          writeCache(`shape:${key}`, r.shape);
          bump();
        },
        () => void asked.delete(key),
      ),
  };
  if (first) queue.unshift(job);
  else queue.push(job);
  pump();
}

/** Drop these lookups if they are still waiting (the lines of a stop the rider left); one already asked carries on. */
function forget(keys: Set<string>) {
  for (let i = queue.length - 1; i >= 0; i--) {
    if (!keys.has(queue[i].key)) continue;
    asked.delete(queue[i].key);
    queue.splice(i, 1);
  }
}

/** The encoded polyline of a ride, or null while unknown. Re-renders the caller when shapes arrive. */
export function useRideShapes(rides: { route: string; from: string; to: string }[]): (string | null)[] {
  const v = useSyncExternalStore(subscribe, () => version);
  const sig = rides.map((r) => keyOf(r.route, r.from, r.to)).join(',');
  useEffect(() => {
    for (const r of rides) ensure(r.route, r.from, r.to);
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo(() => rides.map((r) => lookup(keyOf(r.route, r.from, r.to))), [sig, v]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * Road shapes for the lines onward from a boarding stop (line + boarding stop + the line's last stop ahead),
 * queued behind the rides and asked a few at a time; null until a shape is there (draw it straight meanwhile).
 */
export function useLineShapes(lines: { route: string; from: string; to: string }[]): (string | null)[] {
  const v = useSyncExternalStore(subscribe, () => version);
  const sig = lines.map((r) => keyOf(r.route, r.from, r.to)).join(',');
  useEffect(() => {
    for (const r of lines) ensure(r.route, r.from, r.to, false);
    const wanted = new Set(lines.map((r) => keyOf(r.route, r.from, r.to)));
    return () => forget(wanted);
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo(() => lines.map((r) => lookup(keyOf(r.route, r.from, r.to))), [sig, v]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** The itinerary with its rides drawn along the roads once their shapes are known. */
export function useRoadItinerary(it: Itinerary | null): Itinerary | null {
  const rides = useMemo(() => (it ? it.legs.filter((l) => l.mode !== 'WALK' && l.route && l.from.stopId && l.to.stopId) : []), [it]);
  const shapes = useRideShapes(rides.map((l) => ({ route: l.route!.shortName, from: l.from.stopId!, to: l.to.stopId! })));
  return useMemo(() => {
    if (!it || !shapes.some(Boolean)) return it;
    return { ...it, legs: it.legs.map((l) => (rides.includes(l) && shapes[rides.indexOf(l)] ? { ...l, polyline: shapes[rides.indexOf(l)] } : l)) };
  }, [it, rides, shapes]);
}
