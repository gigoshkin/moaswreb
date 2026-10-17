// How far off are TTC's live arrival predictions? Reads the logger's raw
// snapshots and compares each "route X in N min" at a hot stop with the time
// a bus of that route actually left the stop (its live position within 40 m).
//
//   node apps/server/scripts/prediction-accuracy.mjs <data/raw dir> <stops.json>
//
// stops.json: [{id, lat, lon}] for the hot stops (from GET /stops?q=<code>).
// Results for 17 Oct: knowledge-base/ttc-prediction-accuracy.md.
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

const [rawDir, stopsFile] = process.argv.slice(2);
const NEAR_M = 40;
const GAP_MS = 90_000;

const files = fs.readdirSync(rawDir, { recursive: true }).filter((f) => /\.jsonl(\.gz)?$/.test(f));
const snaps = files
  .flatMap((f) => {
    const buf = fs.readFileSync(path.join(rawDir, f));
    return (f.endsWith('.gz') ? gunzipSync(buf) : buf).toString('utf8').split('\n');
  })
  .flatMap((l) => {
    try {
      return l ? [JSON.parse(l)] : [];
    } catch {
      return []; // a line cut off by a restart
    }
  })
  .sort((a, b) => a.t.localeCompare(b.t));
const T = (s) => Date.parse(s.t);
const STOPS = Object.fromEntries(JSON.parse(fs.readFileSync(stopsFile, 'utf8')).map((s) => [s.id, s]));

const dist = (a, b) => {
  const k = Math.PI / 180;
  const x = (b.lon - a.lon) * k * Math.cos(((a.lat + b.lat) / 2) * k);
  return Math.hypot(x, (b.lat - a.lat) * k) * 6_371_000;
};

// Route id → number, from the logger's stop-routes snapshots.
const ROUTES = {};
for (const s of snaps) if (s.kind === 'stop-routes') for (const r of s.data) ROUTES[r.id] = r.shortName;

// Times the hot loop ran; a prediction is skipped if the loop paused before the bus left.
const hotT = snaps.filter((s) => s.kind === 'arrivals').map(T);
const gapBetween = (a, b) => {
  let prev = null;
  for (const t of hotT) {
    if (t < a - GAP_MS / 2) {
      prev = t;
      continue;
    }
    if (prev !== null && t - prev > GAP_MS) return true;
    prev = t;
    if (t > b) break;
  }
  return false;
};

// Which direction (pattern) the arrivals feed means for each stop and route.
const patterns = {};
for (const s of snaps)
  if (s.kind === 'arrivals') for (const a of s.data) (patterns[`${s.key}|${a.shortName}`] ??= new Set()).add(a.patternSuffix);

const tracks = new Map();
for (const s of snaps) {
  if (s.kind !== 'positions' || !ROUTES[s.key]) continue;
  for (const [pattern, vehicles] of Object.entries(s.data))
    for (const v of vehicles) {
      const key = `${ROUTES[s.key]}|${v.vehicleId}|${pattern}`;
      if (!tracks.has(key)) tracks.set(key, []);
      tracks.get(key).push({ t: T(s), lat: v.lat, lon: v.lon, next: v.nextStopId });
    }
}

// Departures: the last sample near the stop, or (no sample near it) when nextStopId moved past it.
const departures = [];
for (const [key, track] of tracks) {
  const [route, vehicle, pattern] = key.split('|');
  for (const [id, stop] of Object.entries(STOPS)) {
    if (!patterns[`${id}|${route}`]?.has(pattern)) continue;
    let run = null;
    for (let i = 0; i < track.length; i++) {
      const p = track[i];
      const prev = track[i - 1];
      const near = dist(p, stop) < NEAR_M;
      if (near) {
        run ??= { first: p.t };
        run.last = p.t;
      }
      if (!run && prev && prev.next === id && p.next !== id && dist(prev, stop) >= NEAR_M && p.t - prev.t < GAP_MS)
        departures.push({ stop: id, route, vehicle, t: (prev.t + p.t) / 2, waitMin: 0 });
      if (run && (!near || i === track.length - 1)) {
        departures.push({ stop: id, route, vehicle, t: run.last, waitMin: (run.last - run.first) / 60_000 });
        run = null;
      }
    }
  }
}

const rows = [];
for (const s of snaps) {
  if (s.kind !== 'arrivals') continue;
  for (const a of s.data) {
    const t = T(s);
    const next = departures
      .filter((d) => d.stop === s.key && d.route === a.shortName && d.t >= t - 30_000)
      .sort((x, y) => x.t - y.t)[0];
    if (!next || gapBetween(t, next.t)) continue;
    rows.push({
      lead: a.realtimeArrivalMinutes,
      err: (next.t - t) / 60_000 - a.realtimeArrivalMinutes,
      bus: `${next.stop}|${next.vehicle}|${next.t}`,
      waited: next.waitMin >= 3,
    });
  }
}

const q = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))];
const table = (rs, title) => {
  console.log(`\n${title}\nTTC said  predictions  buses  median miss  80% within  ≥2 early  ≥2 late   (miss = actual − predicted, min)`);
  for (const [lo, hi] of [[0, 2], [3, 5], [6, 10], [11, 15], [16, 20], [21, 30]]) {
    const r = rs.filter((x) => x.lead >= lo && x.lead <= hi);
    if (!r.length) continue;
    const e = r.map((x) => x.err);
    const abs = e.map(Math.abs);
    const pct = (n) => `${Math.round((100 * n) / r.length)}%`;
    console.log(
      `${lo}-${hi} min`.padEnd(10),
      String(r.length).padStart(11),
      String(new Set(r.map((x) => x.bus)).size).padStart(6),
      q(e, 0.5).toFixed(1).padStart(12),
      q(abs, 0.8).toFixed(1).padStart(11),
      pct(e.filter((x) => x <= -2).length).padStart(9),
      pct(e.filter((x) => x >= 2).length).padStart(8),
    );
  }
};

console.log(`${snaps.length} snapshots, ${snaps[0]?.t} → ${snaps.at(-1)?.t}; ${departures.length} departures observed`);
table(rows.filter((r) => !r.waited), 'Bus passing through the stop');
table(rows.filter((r) => r.waited), 'Bus waited ≥3 min at the stop (end of line)');
