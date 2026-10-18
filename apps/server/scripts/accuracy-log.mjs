// Live check of TTC arrival predictions. Every 60 s, until a Tbilisi wall-clock
// end time, reads the arrival board of a few busy stops and writes JSON lines:
//
//   {kind:'poll', t, stop, board:[{route, suffix, min, sched, rt}]}   every board read
//   {kind:'arrival', stop, route, suffix, observedAt, how, resolutionSec, preds:[{t, horizonMin, predictedAt}]}
//
// An "arrival" is one vehicle: the predictions made for it while it was the next
// vehicle of its route on the board, and the time it was seen to arrive: the
// first poll that said 0 min ("zero"), or, if it vanished from the board (or the
// prediction jumped to the following vehicle) while it was 5 min away or less,
// the midpoint between the last poll that showed it and the first that didn't
// ("vanished", ±30 s). Vehicles lost further out are dropped ("lost" lines).
//
//   node apps/server/scripts/accuracy-log.mjs <out.jsonl> [--until HH:mm] [--stops 1:1405,1:1408]
//   node apps/server/scripts/accuracy-report.mjs <out.jsonl>
//
// No dependencies. The API key is read from TTC's public page at runtime (as
// the server does) and never written anywhere.
import fs from 'node:fs';

const args = process.argv.slice(2);
const out = args[0] && !args[0].startsWith('--') ? args[0] : 'accuracy.jsonl';
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const UNTIL = opt('until', '14:00');
const STOPS = opt('stops', process.env.HOT_STOPS || '1:1405,1:1408,1:1406').split(',').map((s) => s.trim()).filter(Boolean);
const POLL_MS = Number(opt('every', '60')) * 1000;
const SITE = 'https://transit.ttc.com.ge/';
const API = 'https://transit.ttc.com.ge/pis-gateway/api';
const UA = 'tbilisi-transit-hackathon/0.1 (Hacktoberfest Georgia 2026; accuracy check)';
const NEAR_MIN = 5;
const JUMP_MS = 3 * 60_000;
const TBILISI_MS = 4 * 3_600_000;

const endAt = (() => {
  const today = new Date(Date.now() + TBILISI_MS).toISOString().slice(0, 10);
  return Date.parse(`${today}T${UNTIL}:00Z`) - TBILISI_MS;
})();

const write = (obj) => fs.appendFileSync(out, JSON.stringify(obj) + '\n');

let key = null;
const loadKey = async () => {
  const html = await (await fetch(SITE, { headers: { 'User-Agent': UA } })).text();
  const m = html.match(/"PIS_GATEWAY_KEY"\s*:\s*"([^"]+)"/);
  if (!m) throw new Error('PIS_GATEWAY_KEY not found');
  key = m[1];
};

const board = async (stop, retry = true) => {
  if (!key) await loadKey();
  const url = `${API}/v2/stops/${encodeURIComponent(stop)}/arrival-times?locale=en&ignoreScheduledArrivalTimes=false`;
  const res = await fetch(url, { headers: { 'X-Api-Key': key, 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
  if (res.status === 401 && retry) {
    key = null;
    return board(stop, false);
  }
  if (!res.ok) throw new Error(`TTC ${res.status}`);
  return res.json();
};

/** stop|route|suffix → the vehicle currently next on the board. */
const tracked = new Map();

const finish = (k, v, observedAt, how, resolutionSec) => {
  const [stop, route, suffix] = k.split('|');
  write({
    kind: 'arrival',
    stop,
    route,
    suffix,
    observedAt: new Date(observedAt).toISOString(),
    how,
    resolutionSec,
    preds: v.preds.map((p) => ({ t: new Date(p.t).toISOString(), horizonMin: p.min, predictedAt: new Date(p.t + p.min * 60_000).toISOString() })),
  });
};

const step = async (stop) => {
  const t = Date.now();
  let rows;
  try {
    rows = await board(stop);
  } catch (err) {
    write({ kind: 'error', t: new Date(t).toISOString(), stop, message: String(err.message ?? err) });
    return;
  }
  const live = rows.filter((r) => r.realtime && Number.isFinite(r.realtimeArrivalMinutes) && r.realtimeArrivalMinutes >= 0);
  write({
    kind: 'poll',
    t: new Date(t).toISOString(),
    stop,
    board: rows.map((r) => ({ route: r.shortName, suffix: r.patternSuffix, min: r.realtimeArrivalMinutes, sched: r.scheduledArrivalMinutes, rt: r.realtime })),
  });
  const seen = new Set();
  for (const r of live) {
    const k = `${stop}|${r.shortName}|${r.patternSuffix}`;
    if (seen.has(k)) continue; // the stop-wide board shows one per route; keep the first
    seen.add(k);
    const min = r.realtimeArrivalMinutes;
    const predicted = t + min * 60_000;
    let v = tracked.get(k);
    if (v?.done && min === 0) continue; // still at the stop: same vehicle, already counted
    if (v) {
      const prev = v.preds[v.preds.length - 1];
      const prevPred = prev.t + prev.min * 60_000;
      if (v.done || (predicted - prevPred > JUMP_MS && prev.min <= NEAR_MIN)) {
        // The vehicle we followed is gone; this is the next one.
        if (!v.done) finish(k, v, (prev.t + t) / 2, 'vanished', Math.round((t - prev.t) / 2000));
        v = null;
      } else if (predicted - prevPred > JUMP_MS) {
        write({ kind: 'lost', t: new Date(t).toISOString(), stop, route: r.shortName, suffix: r.patternSuffix, lastMin: prev.min });
        v = null;
      }
    }
    if (!v) {
      v = { preds: [], done: false };
      tracked.set(k, v);
    }
    if (v.done) continue;
    v.preds.push({ t, min });
    if (min === 0) {
      finish(k, v, t, 'zero', Math.round(POLL_MS / 2000));
      v.done = true;
    }
  }
  // Vehicles no longer on the board at all.
  for (const [k, v] of tracked) {
    if (!k.startsWith(`${stop}|`) || seen.has(k)) continue;
    const prev = v.preds[v.preds.length - 1];
    if (!v.done && prev) {
      if (prev.min <= NEAR_MIN) finish(k, v, (prev.t + t) / 2, 'vanished', Math.round((t - prev.t) / 2000));
      else write({ kind: 'lost', t: new Date(t).toISOString(), stop, k, lastMin: prev.min });
    }
    tracked.delete(k);
  }
};

write({ kind: 'start', t: new Date().toISOString(), stops: STOPS, until: new Date(endAt).toISOString(), pollSec: POLL_MS / 1000 });
while (Date.now() < endAt) {
  const started = Date.now();
  for (const s of STOPS) {
    await step(s);
    await new Promise((r) => setTimeout(r, 800)); // stay well under TTC's ~1.4 req/s
  }
  const wait = POLL_MS - (Date.now() - started);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}
write({ kind: 'end', t: new Date().toISOString() });
