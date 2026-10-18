import * as Location from 'expo-location';
import { ask } from '../ui/Dialog';

export type Here = { lat: number; lon: number } | 'denied' | 'error' | 'cancelled';

let inFlight: Promise<Here> | null = null;

/**
 * The phone's position for "Current location" and the map's locate button.
 * Explains the request in our own dialog before the system one, never asks twice at once
 * (a double tap would open two system dialogs), and prefers a recent fix over waiting for a new one.
 */
export function locateMe(): Promise<Here> {
  inFlight ??= find().finally(() => (inFlight = null));
  return inFlight;
}

async function find(): Promise<Here> {
  try {
    let perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted) {
      if (!perm.canAskAgain) return 'denied';
      const ok = await ask({ title: 'Use your location?', message: 'Your location sets the starting point of the trip. Nothing is tracked.', confirm: 'Continue', cancel: 'Not now' });
      if (!ok) return 'cancelled';
      perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) return 'denied';
    }
    const last = await Location.getLastKnownPositionAsync({ maxAge: 2 * 60_000 }).catch(() => null);
    const pos = last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    return { lat: pos.coords.latitude, lon: pos.coords.longitude };
  } catch {
    return 'error';
  }
}

/** The phone's position for the assistant: never asks. null when location is off or not allowed yet. */
export async function quietHere(): Promise<{ lat: number; lon: number } | null> {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted) return null;
    // A recent fix, else a new one for at most 4 s: a message must not wait on the GPS.
    const fresh = Promise.race([Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), new Promise<null>((r) => setTimeout(() => r(null), 4000))]);
    const pos = (await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000 }).catch(() => null)) ?? (await fresh);
    return pos ? { lat: pos.coords.latitude, lon: pos.coords.longitude } : null;
  } catch {
    return null;
  }
}
