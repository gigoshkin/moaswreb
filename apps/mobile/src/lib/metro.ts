import type { StopHit, StopLine } from '@transit/shared';
import { distM, type BuiltRide } from './chain';

// The metro as one network for the hand builder: boarding at any station offers
// every station, and a trip that needs another line becomes a ride per line,
// changing at the interchange. Plain data and functions; the loading is in useStopData.

type Station = { id: string; name: string; lat: number; lon: number };

/** Two metro stations of different lines this close are one interchange (Station Square 1 and 2 are ~170 m apart). */
export const METRO_CHANGE_M = 400;

export interface MetroNet {
  stations: Record<string, Station>;
  /** Each line's run as asked at a station: that station, then the stations it goes on to. */
  runs: { label: string; stops: string[] }[];
  /** Stations whose lines are in `runs`. */
  asked: string[];
}

export const emptyNet = (): MetroNet => ({ stations: {}, runs: [], asked: [] });

/** Add the metro lines at `station` (as GET /stops/:id/lines gives them). */
export function addLines(net: MetroNet, station: Station, lines: StopLine[]): MetroNet {
  if (net.asked.includes(station.id)) return net;
  const stations = { ...net.stations, [station.id]: pick(station) };
  const runs = [...net.runs];
  for (const l of lines) {
    if (l.mode !== 'SUBWAY' || !l.next.length) continue;
    for (const s of l.next) stations[s.id] ??= pick(s);
    runs.push({ label: l.shortName, stops: [station.id, ...l.next.map((s) => s.id)] });
  }
  return { stations, runs, asked: [...net.asked, station.id] };
}
const pick = (s: Station): Station => ({ id: s.id, name: s.name, lat: s.lat, lon: s.lon });

/** Both stops are metro stations close enough to change between. */
export const metroChange = (a: StopHit, b: StopHit) => a.mode === 'SUBWAY' && b.mode === 'SUBWAY' && (a.id === b.id || distM(a, b) <= METRO_CHANGE_M);

type Edge = { to: string; label: string };
type State = { id: string; label: string };
const CHANGE_COST = 50;

/** Cheapest way from `from` to every station: fewest changes first, then fewest stops. Metro runs both ways. */
function search(net: MetroNet, from: string) {
  const edges = new Map<string, Edge[]>();
  const link = (a: string, b: string, label: string) => {
    if (!edges.has(a)) edges.set(a, []);
    if (!edges.get(a)!.some((e) => e.to === b && e.label === label)) edges.get(a)!.push({ to: b, label });
  };
  for (const r of net.runs)
    for (let i = 1; i < r.stops.length; i++) {
      link(r.stops[i - 1], r.stops[i], r.label);
      link(r.stops[i], r.stops[i - 1], r.label);
    }
  const ids = Object.keys(net.stations);
  // Walking between two stations of an interchange (label '': not on a line).
  for (const a of ids) for (const b of ids) if (a !== b && distM(net.stations[a], net.stations[b]) <= METRO_CHANGE_M) link(a, b, '');

  const key = (s: State) => `${s.id}|${s.label}`;
  const cost = new Map<string, number>([[key({ id: from, label: '' }), 0]]);
  const prev = new Map<string, State>();
  const open: State[] = [{ id: from, label: '' }];
  const done = new Set<string>();
  while (open.length) {
    open.sort((x, y) => cost.get(key(x))! - cost.get(key(y))!);
    const cur = open.shift()!;
    const ck = key(cur);
    if (done.has(ck)) continue;
    done.add(ck);
    for (const e of edges.get(cur.id) ?? []) {
      // Riding on is 1 a stop, changing lines (or walking to the other station) costs a lot more.
      const step = e.label === '' ? CHANGE_COST : 1 + (cur.label && cur.label !== e.label ? CHANGE_COST : 0);
      if (e.label === '' && cur.label === '' && cur.id !== from) continue; // no two walks in a row
      const next = { id: e.to, label: e.label };
      const nk = key(next);
      const c = cost.get(ck)! + step;
      if (c < (cost.get(nk) ?? Infinity)) {
        cost.set(nk, c);
        prev.set(nk, cur);
        open.push(next);
      }
    }
  }
  return { cost, prev, key };
}

/** The best state at `to` that arrives on a train (not by walking over from the other station). */
function arrival(net: MetroNet, s: ReturnType<typeof search>, to: string): State | null {
  let best: { st: State; c: number } | null = null;
  for (const r of new Set(net.runs.map((x) => x.label))) {
    const c = s.cost.get(s.key({ id: to, label: r }));
    if (c !== undefined && (!best || c < best.c)) best = { st: { id: to, label: r }, c };
  }
  return best?.st ?? null;
}

const hit = (s: Station): StopHit => ({ ...s, mode: 'SUBWAY' });
/** The same station, or the other station of its interchange: no train trip between them. */
const twins = (a: Station | undefined, b: Station) => !a || a.id === b.id || distM(a, b) <= METRO_CHANGE_M;

/** Every station a train takes you to from `from`, changing lines as needed. */
export function metroReach(net: MetroNet, from: string): StopHit[] {
  const s = search(net, from);
  const at = net.stations[from];
  return Object.values(net.stations).filter((st) => !twins(at, st) && arrival(net, s, st.id)).map(hit);
}

/**
 * The metro trip from `from` to `to` as single-line rides, in order: line A to the
 * interchange, then line B on (the planner takes one line per step). Null when no train goes there.
 */
export function metroRides(net: MetroNet, from: string, to: string): BuiltRide[] | null {
  if (!net.stations[to] || twins(net.stations[from], net.stations[to])) return null;
  const s = search(net, from);
  let at = arrival(net, s, to);
  if (!at) return null;
  const states: State[] = [at];
  while (at && !(at.id === from && at.label === '')) {
    at = s.prev.get(s.key(at)) ?? null;
    if (at) states.unshift(at);
  }
  const rides: BuiltRide[] = [];
  let run: { label: string; stops: string[] } | null = null;
  const close = () => {
    if (run && run.stops.length > 1) {
      const stops = run.stops.map((id) => net.stations[id]);
      rides.push({ board: hit(stops[0]), off: hit(stops.at(-1)!), lines: [{ label: run.label, kind: 'metro' }], skipped: [], path: stops.map(({ lat, lon }) => ({ lat, lon })) });
    }
    run = null;
  };
  for (let i = 1; i < states.length; i++) {
    const a = states[i - 1];
    const b = states[i];
    if (b.label === '') close();
    else if (run && run.label === b.label) run.stops.push(b.id);
    else {
      close();
      run = { label: b.label, stops: [a.id, b.id] };
    }
  }
  close();
  return rides.length ? rides : null;
}

/** Where the metro lines run, for drawing: each line's stations in order, straight between stations. */
export function metroLinesDrawn(net: MetroNet): { lat: number; lon: number }[][] {
  return net.runs.map((r) => r.stops.map((id) => net.stations[id]).filter(Boolean).map(({ lat, lon }) => ({ lat, lon })));
}
