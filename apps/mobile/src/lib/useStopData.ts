import type { StopHit, StopLine } from '@transit/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { hasApi, nearStops, reversePlace, stopLines } from './api';
import { readCache, writeCache } from './cache';
import { distM } from './chain';
import { METRO_CHANGE_M, addLines, emptyNet, type MetroNet } from './metro';

type Point = { lat: number; lon: number };

/**
 * Stops around a point, refreshed (debounced) as the point moves. Null point loads nothing.
 * Metro stations are asked for on their own as well, so a station is always among the dots
 * even where bus stops crowd the nearest-stops answer.
 */
export function useStopsNear(p: Point | null) {
  const [stops, setStops] = useState<StopHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const seen = useRef(new Map<string, StopHit>());
  const key = p ? `${p.lat.toFixed(4)},${p.lon.toFixed(4)}` : '';
  useEffect(() => {
    if (!p) return;
    let live = true;
    setLoading(true);
    const t = setTimeout(() => {
      // An API server from before the limit was raised answers 400 to 60: ask for 20 then.
      const all = nearStops(p, { radiusM: 500, limit: 60 }).catch(() => nearStops(p, { radiusM: 400, limit: 20 }));
      const metro = nearStops(p, { radiusM: 900, limit: 6, mode: 'SUBWAY' }).catch(() => [] as StopHit[]);
      Promise.all([all, metro]).then(
        ([r, m]) => {
          if (!live) return;
          // Stops already seen stay, so the dots don't flicker while panning.
          for (const s of [...r, ...m]) seen.current.set(s.id, s);
          setStops(r.length || m.length ? [...seen.current.values()].filter((s) => distM(p, s) < 900) : []);
          setError(false);
          setLoading(false);
        },
        () => live && (setError(true), setLoading(false)),
      );
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [key, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  return { stops, loading, error, retry: () => setAttempt((n) => n + 1) };
}

/** Every line at a stop and where it goes next. */
export function useLines(stopId: string | null) {
  const [state, setState] = useState<{ id: string; lines: StopLine[] | null; error: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!stopId) return;
    setState(null);
    let live = true;
    stopLines(stopId).then(
      (r) => live && setState({ id: stopId, lines: r.lines, error: false }),
      () => live && setState({ id: stopId, lines: null, error: true }),
    );
    return () => {
      live = false;
    };
  }, [stopId, attempt]);
  const mine = state && state.id === stopId ? state : null;
  return { lines: mine?.lines ?? null, error: mine?.error ?? false, retry: () => setAttempt((n) => n + 1) };
}

/** The address under the pin: looked up (debounced) as the map settles, null while it loads or when nothing is known. */
export function useAddress(p: Point | null) {
  const [state, setState] = useState<{ key: string; name: string | null; sub: string | null } | null>(null);
  const key = p ? `${p.lat.toFixed(5)},${p.lon.toFixed(5)}` : '';
  useEffect(() => {
    if (!p) return;
    if (!hasApi) {
      setState({ key, name: null, sub: null });
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      reversePlace(p).then(
        (hit) => live && setState({ key, name: hit?.name ?? null, sub: hit?.address ?? null }),
        () => live && setState({ key, name: null, sub: null }),
      );
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const mine = state && state.key === key ? state : null;
  return { loading: !!p && !mine, name: mine?.name ?? null, sub: mine?.sub ?? null };
}

// ——— The metro as one network. ———

/** A station asked about: every metro station this far around it comes back (the most /stops/near allows). */
const AROUND_M = 2000;
/** A station within this of an asked one is covered: another line's station by it is found. */
const COVERED_M = AROUND_M - METRO_CHANGE_M - 100;
const NET_KEY = 'metro:net';
const NET_DAYS = 7;
let netLoad: Promise<MetroNet> | null = null;

/**
 * Every metro line connected to `seed`: its lines, then any other line with a station by one of theirs
 * (an interchange), asked once and kept on the phone for a week. About a dozen small requests the first time.
 */
async function loadNet(seed: StopHit, seedLines: StopLine[]): Promise<MetroNet> {
  const saved = readCache<{ at: number; net: MetroNet }>(NET_KEY);
  if (saved && Date.now() - saved.at < NET_DAYS * 86_400_000 && saved.net.stations[seed.id]) return saved.net;
  let net = addLines(emptyNet(), seed, seedLines);
  const centres: { lat: number; lon: number }[] = [];
  let failed = false;
  for (let round = 0; round < 6; round++) {
    const fresh: { lat: number; lon: number }[] = [];
    for (const s of Object.values(net.stations)) {
      if (centres.some((c) => distM(c, s) <= COVERED_M)) continue;
      centres.push(s);
      fresh.push(s);
    }
    if (!fresh.length) break;
    const around = await Promise.all(
      fresh.map((c) =>
        nearStops(c, { radiusM: AROUND_M, limit: 60, mode: 'SUBWAY' }).catch(() => {
          failed = true;
          return [] as StopHit[];
        }),
      ),
    );
    const known = Object.values(net.stations);
    const others = new Map<string, StopHit>();
    for (const s of around.flat()) if (!net.stations[s.id] && known.some((k) => distM(k, s) <= METRO_CHANGE_M)) others.set(s.id, s);
    for (const s of others.values()) {
      const r = await stopLines(s.id).catch(() => {
        failed = true;
        return null;
      });
      if (r) net = addLines(net, s, r.lines);
    }
  }
  if (!failed) writeCache(NET_KEY, { at: Date.now(), net });
  return net;
}

/**
 * The metro network from a boarding station: its own lines at once (`lines`, as loaded for it),
 * every connected line when they are in. Null for a stop that is not a metro station.
 */
export function useMetroNet(board: StopHit | null, lines: StopLine[] | null): MetroNet | null {
  const metro = board?.mode === 'SUBWAY' && !!lines;
  const [full, setFull] = useState<MetroNet | null>(null);
  useEffect(() => {
    if (!metro || !board || !lines) return;
    let live = true;
    netLoad ??= loadNet(board, lines).finally(() => (netLoad = null));
    netLoad.then(
      (n) => {
        if (live && n.stations[board.id]) setFull(n);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [metro, board?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const own = useMemo(() => (metro && board && lines ? addLines(emptyNet(), board, lines) : null), [metro, board, lines]);
  if (!own || !board) return null;
  return full?.stations[board.id] ? full : own;
}
