import { hasApi, nearStops, reversePlace } from './api';
import { DROPPED_PIN, NAME_WAIT_MS, isDropped, pinLabel, within } from './placeNames';
import { getTrip, listTrips, saveTrip, type Place } from './trips';

const key = (p: { lat: number; lon: number }) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;

// One lookup per point for the life of the app, so a trip form, the route builder and the Today list
// asking about the same pin share a single request. A lookup that failed is dropped and may be asked again.
const lookups = new Map<string, Promise<string | null>>();

/** The label for a pin: its address, else the closest stop, else "Dropped pin". Null when the server could not be asked. */
async function lookup(p: { lat: number; lon: number }): Promise<string | null> {
  const [hit, stops] = await Promise.all([
    reversePlace(p).then(
      (h) => ({ ok: true as const, h }),
      () => ({ ok: false as const, h: null }),
    ),
    // The stops are only used when the address is missing, but asking together costs no time.
    nearStops(p, { radiusM: 350, limit: 6 }).catch(() => null),
  ]);
  if (!hit.ok && !stops) return null;
  return pinLabel(hit.h, stops);
}

/** The best name for the point, waiting at most `waitMs`. "Dropped pin" when nothing was found in time. */
export async function pinName(p: { lat: number; lon: number }, waitMs = NAME_WAIT_MS): Promise<string> {
  if (!hasApi) return DROPPED_PIN;
  const k = key(p);
  let q = lookups.get(k);
  if (!q) {
    q = lookup(p);
    lookups.set(k, q);
    q.then((v) => v === null && lookups.get(k) === q && lookups.delete(k));
  }
  return (await within(q, waitMs)) ?? DROPPED_PIN;
}

/**
 * The place with a real name when its label is only "Dropped pin" (a pin from
 * before names were looked up, or one confirmed before the lookup came back).
 * Any other place is returned as it is.
 */
export async function nameOfPlace<P extends Place>(place: P, waitMs = NAME_WAIT_MS): Promise<P> {
  if (!isDropped(place.label)) return place;
  const label = await pinName(place, waitMs);
  return isDropped(label) ? place : { ...place, label };
}

let healing = false;

/**
 * Saved trips that still carry "Dropped pin" for an end, or as their name (the
 * default name is the destination's), get the real names once, one after the
 * other. Does nothing when no trip needs it.
 */
export async function nameSavedTrips(): Promise<void> {
  if (healing || !hasApi) return;
  const todo = listTrips().filter((t) => isDropped(t.from.label) || isDropped(t.to.label) || isDropped(t.name));
  if (!todo.length) return;
  healing = true;
  try {
    for (const t of todo) {
      const [from, to] = await Promise.all([nameOfPlace(t.from), nameOfPlace(t.to)]);
      const cur = getTrip(t.id); // may have been edited while we waited
      if (!cur) continue;
      const name = isDropped(cur.name) && !isDropped(to.label) ? to.label : cur.name;
      const next = {
        ...cur,
        name,
        from: isDropped(cur.from.label) && cur.from.lat === t.from.lat && cur.from.lon === t.from.lon ? from : cur.from,
        to: isDropped(cur.to.label) && cur.to.lat === t.to.lat && cur.to.lon === t.to.lon ? to : cur.to,
      };
      if (next.name !== cur.name || next.from !== cur.from || next.to !== cur.to) saveTrip(next);
    }
  } finally {
    healing = false;
  }
}
