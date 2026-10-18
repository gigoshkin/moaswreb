// Scores the lines written by accuracy-log.mjs: how far TTC's "arrives in N
// min" was from when the vehicle was seen to arrive, by prediction horizon.
//
//   node apps/server/scripts/accuracy-report.mjs <accuracy.jsonl> [--json]
//
// error = predicted arrival − observed arrival, in minutes (negative = the
// vehicle came earlier than predicted). The board gives whole minutes and the
// observation is ±30 s, so errors under ~1 min are within the measurement.
import fs from 'node:fs';

const [file, flag] = process.argv.slice(2);
if (!file) {
  console.error('usage: accuracy-report.mjs <accuracy.jsonl> [--json]');
  process.exit(1);
}
const lines = fs
  .readFileSync(file, 'utf8')
  .split('\n')
  .flatMap((l) => {
    try {
      return l ? [JSON.parse(l)] : [];
    } catch {
      return []; // a line cut off mid-write
    }
  });

// The board has no vehicle ids. A prediction that drops by more than 3 min between two polls a minute apart
// is almost surely another vehicle that showed up ahead (a bus can't cover 4+ min of route in one),
// so such a vehicle is counted as ambiguous and not scored.
const JUMP_MIN = 3;
const consistent = (a) =>
  a.preds.every((p, i) => i === 0 || Date.parse(p.predictedAt) >= Date.parse(a.preds[i - 1].predictedAt) - JUMP_MIN * 60_000);
const allArrivals = lines.filter((l) => l.kind === 'arrival');
const arrivals = allArrivals.filter(consistent);
const ambiguous = allArrivals.length - arrivals.length;
const lost = lines.filter((l) => l.kind === 'lost').length;
const errors = lines.filter((l) => l.kind === 'error').length;
const polls = lines.filter((l) => l.kind === 'poll').length;

/** One sample per prediction: horizon (min ahead) and error (min). Horizon 0 at a "zero" arrival is the observation itself, so it is left out. */
const samples = arrivals.flatMap((a) =>
  a.preds
    .filter((p) => !(a.how === 'zero' && p.horizonMin === 0))
    .map((p) => ({ horizon: p.horizonMin, err: (Date.parse(p.predictedAt) - Date.parse(a.observedAt)) / 60_000, how: a.how, route: a.route })),
);

const BUCKETS = [
  [0, 2],
  [3, 5],
  [6, 10],
  [11, 15],
  [16, 30],
  [31, Infinity],
];

const stats = (xs) => {
  if (!xs.length) return null;
  const abs = xs.map((s) => Math.abs(s.err)).sort((a, b) => a - b);
  const mid = Math.floor(abs.length / 2);
  const r = (x) => Math.round(x * 100) / 100;
  return {
    n: xs.length,
    meanAbsMin: r(abs.reduce((s, x) => s + x, 0) / abs.length),
    medianAbsMin: r(abs.length % 2 ? abs[mid] : (abs[mid - 1] + abs[mid]) / 2),
    meanSignedMin: r(xs.reduce((s, x) => s + x.err, 0) / xs.length),
    within1MinPct: Math.round((100 * abs.filter((x) => x <= 1).length) / abs.length),
    early2PlusPct: Math.round((100 * xs.filter((x) => x.err >= 2).length) / xs.length),
  };
};

const report = {
  file,
  polls,
  vehicles: arrivals.length,
  byHow: { zero: arrivals.filter((a) => a.how === 'zero').length, vanished: arrivals.filter((a) => a.how === 'vanished').length },
  ambiguous,
  lost,
  fetchErrors: errors,
  overall: stats(samples),
  byHorizon: BUCKETS.map(([lo, hi]) => ({ horizon: hi === Infinity ? `${lo}+` : `${lo}-${hi}`, ...stats(samples.filter((s) => s.horizon >= lo && s.horizon <= hi)) })).filter((b) => b.n),
};

if (flag === '--json') console.log(JSON.stringify(report, null, 2));
else {
  console.log(`${file}: ${polls} board reads, ${report.vehicles} vehicles observed (${report.byHow.zero} at 0 min, ${report.byHow.vanished} vanished), ${ambiguous} ambiguous (skipped), ${lost} lost, ${errors} fetch errors`);
  if (!report.overall) console.log('No scored predictions yet.');
  else {
    console.log('error = predicted - observed (min); early2+ = bus came 2+ min before the prediction');
    console.log('horizon    n     meanAbs  medianAbs  meanSigned  within1  early2+');
    for (const b of [...report.byHorizon, { horizon: 'all', ...report.overall }]) {
      console.log(
        `${b.horizon.padEnd(8)} ${String(b.n).padStart(5)} ${String(b.meanAbsMin).padStart(9)} ${String(b.medianAbsMin).padStart(10)} ${String(b.meanSignedMin).padStart(11)} ${String(b.within1MinPct + '%').padStart(8)} ${String(b.early2PlusPct + '%').padStart(8)}`,
      );
    }
  }
}
