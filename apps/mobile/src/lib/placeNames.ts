// What to call a place picked by dropping a pin on the map. Pure, so the order
// of preference is tested without the network (the lookups are in nameOfPlace.ts).

/** The label of last resort: the pin is on the map but nothing is known about it. */
export const DROPPED_PIN = 'Dropped pin';

/** How long a screen waits for a pin's name before it goes on without one. */
export const NAME_WAIT_MS = 2500;

export const isDropped = (label: string | undefined | null): boolean => !!label && label.trim().toLowerCase() === DROPPED_PIN.toLowerCase();

/** Farther than this a stop says nothing about where the pin is. */
export const NEAR_STOP_MAX_M = 400;

export interface NamedStop {
  name: string;
  distanceM: number;
}

/**
 * The label for a pin: the address the reverse lookup found, else "Near <the
 * closest stop>" when one is within NEAR_STOP_MAX_M, else "Dropped pin".
 */
export function pinLabel(hit: { name?: string | null } | null | undefined, stops: NamedStop[] | null | undefined): string {
  const name = hit?.name?.trim();
  if (name) return name;
  const nearest = [...(stops ?? [])].filter((s) => s.name.trim() && s.distanceM <= NEAR_STOP_MAX_M).sort((a, b) => a.distanceM - b.distanceM)[0];
  return nearest ? `Near ${nearest.name.trim()}` : DROPPED_PIN;
}

/** The promise's value, or undefined if it has not settled within `ms` (it keeps running). */
export function within<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    p.then(
      (v) => (clearTimeout(timer), resolve(v)),
      () => (clearTimeout(timer), resolve(undefined)),
    );
  });
}
