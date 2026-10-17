// Trips stored on the server for reliable alerts (George, 17 Oct). Only stops
// and times: no names, no addresses, no GPS. Linked to a random device id,
// encrypted at rest, deleted after 30 days without a check-in.

export interface StoredTrip {
  /** Client-generated id, stable per trip. */
  id: string;
  fromStopId: string;
  toStopId: string;
  /** Tbilisi wall clock `HH:mm`. */
  arriveBy: string;
  /** ISO weekdays, 1 = Monday. */
  days: number[];
  /** Walk from the user's start point to the first stop, worked out on the phone. */
  walkMin: number;
}

export interface TripsPayload {
  trips: StoredTrip[];
}

/** `data` on every push the server sends, so the app can open the right trip. */
export interface AlertPushData {
  kind: 'leave_soon' | 'plan_changed';
  tripId: string;
  /** ISO time to leave home. */
  leaveAt: string;
}
