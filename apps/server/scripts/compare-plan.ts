// Checks our own planner against TTC's on the same trips: for every line both
// find, how far apart are the leave and arrive times? Run on a machine that can
// reach TTC:  node scripts/compare-plan.ts [YYYY-MM-DDTHH:mm]
import { TtcSource } from '../src/journey/ttc-source.ts';
import { Engine } from '../src/journey/engine.ts';
import { normalizePlan } from '../src/plan/normalize.ts';
import { TtcClient } from '../src/ttc/client.ts';
import { StopIndex } from '../src/ttc/stops.ts';

const arriveBy = process.argv[2] ?? '2026-10-19T09:00';
const [date, time] = arriveBy.split('T');
const pairs: Array<[string, { lat: number; lon: number }, { lat: number; lon: number }]> = [
  ['Heroes Sq → Stadium', { lat: 41.7151, lon: 44.7836 }, { lat: 41.7225, lon: 44.7925 }],
  ['Dighomi → Sarajishvili', { lat: 41.7948, lon: 44.744 }, { lat: 41.7836, lon: 44.7995 }],
  ['Vake → Rustaveli', { lat: 41.7101, lon: 44.7684 }, { lat: 41.7005, lon: 44.7993 }],
  ['Didube → Station Sq', { lat: 41.7449, lon: 44.7819 }, { lat: 41.7226, lon: 44.8012 }],
  ['Isani → Liberty Sq', { lat: 41.6918, lon: 44.8344 }, { lat: 41.6926, lon: 44.8011 }],
];

const ttc = new TtcClient();
const stops = new StopIndex(ttc);
const engine = new Engine(new TtcSource(ttc, stops, process.env.TRANSIT_CACHE ?? null));
const deadline = Date.parse(`${arriveBy}:00+04:00`);
const hm = (iso: string) => new Date(Date.parse(iso) + 4 * 3600e3).toISOString().slice(11, 16);
const diffs: number[] = [];
const departDiffs: number[] = [];

for (const [name, from, to] of pairs) {
  const [fromStops, toStops] = await Promise.all([stops.near(from, { radiusM: 900, limit: 14 }), stops.near(to, { radiusM: 900, limit: 14 })]);
  const own = await engine.solve({ from, to, steps: [{ fromStops: fromStops.map((s) => s.id), toStops: toStops.map((s) => s.id) }], deadline, now: Date.now() });
  const theirs = normalizePlan(await ttc.plan({ from, to, departMode: 'arriveBy', date, time, modes: ['BUS', 'SUBWAY', 'GONDOLA'], optimize: 'quick', locale: 'en' }));
  console.log(`\n${name}  (arrive by ${arriveBy})`);
  for (const t of theirs) {
    const lines = t.legs.filter((l) => l.route).map((l) => l.route!.shortName);
    const tl = t.legs.find((l) => l.route)!;
    const line = `  TTC ${lines.join('>')}: ${hm(tl.departAt)}-${hm(tl.arriveAt)}`;
    if (lines.length !== 1) {
      console.log(`${line}   (transfer: TTC's planner only)`);
      continue;
    }
    // Compare like with like: same line, same boarding and alighting stop.
    const fromId = await stops.snap(tl.from, tl.mode, 40);
    const toId = await stops.snap(tl.to, tl.mode, 40);
    // Ask our planner for exactly TTC's stops and line, so the two are compared like with like.
    const mine = fromId && toId ? (await engine.solve({ from, to, steps: [{ fromStops: [fromId], toStops: [toId], routes: [lines[0]] }], deadline, now: Date.now() }))[0] : undefined;
    const ml = mine?.legs.find((l) => l.route);
    if (!ml) {
      console.log(`${line}   ours: nothing for those stops`);
      continue;
    }
    const dd = Math.round((Date.parse(ml.departAt) - Date.parse(tl.departAt)) / 60000);
    const ride = Math.round((ml.durationSec - tl.durationSec) / 60);
    diffs.push(Math.abs(ride));
    departDiffs.push(Math.abs(dd));
    console.log(`${line}   ours: ${hm(ml.departAt)}-${hm(ml.arriveAt)}  (same stops; depart ${dd >= 0 ? '+' : ''}${dd} min, ride ${ride >= 0 ? '+' : ''}${ride} min)`);
  }
  console.log(`  ours also: ${own.filter((o) => !theirs.some((t) => t.legs.some((l) => l.route?.shortName === o.legs.find((x) => x.route)?.route?.shortName))).map((o) => o.id).join(', ') || '-'}`);
}
const mean = (xs: number[]) => (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1);
if (diffs.length) console.log(`\nSame line and same stops, ${diffs.length} trips: ride time differs by ${mean(diffs)} min on average (max ${Math.max(...diffs)}); departure by ${mean(departDiffs)} min (max ${Math.max(...departDiffs)}).`);
process.exit(0);
