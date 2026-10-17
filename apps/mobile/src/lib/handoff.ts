import type { LatLon, PlanResponse } from '@transit/shared';
import { router } from 'expo-router';
import type { Place, SavedTrip } from './trips';

// State handed between screens. Route params only carry strings, so pickers
// and previews park their data here and the next screen picks it up.

export type PickKind = 'from' | 'to' | 'home';

let pending: ((p: Place | null) => void) | null = null;

export interface PickOptions {
  /** Where "Select on map" opens: usually the other end of the trip. */
  near?: LatLon | null;
}
let pickOpts: PickOptions = {};
export const pickOptions = (): PickOptions => pickOpts;

/** Opens the place picker; resolves with the choice, or null if closed. */
export function pickPlace(kind: PickKind, opts: PickOptions = {}): Promise<Place | null> {
  pending?.(null);
  pickOpts = opts;
  return new Promise((resolve) => {
    pending = resolve;
    router.push({ pathname: '/pick-place', params: { kind } });
  });
}

/** Called by the picker: with a place when chosen, with null when it closes. */
export function finishPick(place: Place | null) {
  pending?.(place);
  pending = null;
}

/** What the route builder starts from, and what it hands back. */
export interface RouteDraft {
  from: Place | null;
  to: Place | null;
  arriveBy: string;
  days: number[];
}
let routeDraftNow: RouteDraft | null = null;
let routePending: ((r: { from: Place; to: Place } | null) => void) | null = null;

/** Opens the route builder on the map; resolves with the chosen ends, or null if closed. */
export function buildRoute(draft: RouteDraft): Promise<{ from: Place; to: Place } | null> {
  routePending?.(null);
  routeDraftNow = draft;
  return new Promise((resolve) => {
    routePending = resolve;
    router.push('/trip/route');
  });
}

export const routeDraft = (): RouteDraft => routeDraftNow ?? { from: null, to: null, arriveBy: '09:00', days: [1, 2, 3, 4, 5] };

/** Called by the builder: with the ends on Done, with null when it closes. */
export function finishRoute(r: { from: Place; to: Place } | null) {
  routePending?.(r);
  routePending = null;
}

/** Add-trip form prefilled from chat (a proposed trip or a timetable event). */
export type TripDraft = Partial<Omit<SavedTrip, 'id'>>;
let draft: TripDraft | null = null;

export function openNewTrip(prefill?: TripDraft) {
  draft = prefill ?? null;
  router.push('/trip/edit');
}

export const takeDraft = (): TripDraft | null => {
  const d = draft;
  draft = null;
  return d;
};

/** A plan from chat shown in Trip detail before it's saved. */
export interface Preview {
  plan: PlanResponse;
  itineraryId: string;
  name: string;
  from: Place;
  to: Place;
}
const previews = new Map<string, Preview>();

export function openPreview(p: Preview) {
  const id = `p${previews.size + 1}`;
  previews.set(id, p);
  router.push({ pathname: '/trip/[id]', params: { id, preview: '1' } });
}

export const getPreview = (id: string) => previews.get(id);
