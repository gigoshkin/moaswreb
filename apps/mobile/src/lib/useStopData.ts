import type { StopHit, StopLine } from '@transit/shared';
import { useEffect, useRef, useState } from 'react';
import { hasApi, nearStops, reversePlace, stopLines } from './api';
import { distM } from './chain';

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
