// Chat input (request 0001): one chat screen takes text, photos and PDFs and
// answers with action cards. Numbers in cards always come from code (TTC data),
// never from the model. Proposals (trips, events) are confirmed by the user and
// stored on the phone; the server keeps no user data.

import type { JourneyStep, LatLon, PlanAvoid, PlanResponse } from './plan.ts';
import type { RideStep } from './ways.ts';

export interface ChatAttachment {
  kind: 'image' | 'pdf';
  /** e.g. image/jpeg, image/png, application/pdf */
  mediaType: string;
  /** Base64 without a data: prefix. */
  data: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  /** Only read on the last user message. */
  attachments?: ChatAttachment[];
}

export interface TripContext {
  name: string;
  from: LatLon & { label: string };
  to: LatLon & { label: string };
  arriveBy: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  /** The user's saved trips, sent from the phone as context for this request only. */
  trips?: TripContext[];
  /** The user's home (Settings), so "from home" needs no question. For this request only. */
  home?: LatLon & { label: string };
  /** Extra minutes the user wants on top of the walk (Settings). */
  bufferMin?: number;
  locale?: 'ka' | 'en';
}

export interface StopHit {
  id: string;
  name: string;
  lat: number;
  lon: number;
  mode: string;
}

export interface Arrival {
  route: string;
  color: string | null;
  headsign: string;
  minutes: number;
  realtime: boolean;
}

export interface ProposedPlace extends LatLon {
  label: string;
}

export interface ProposedTrip {
  name: string;
  from: ProposedPlace;
  to: ProposedPlace;
  /** Tbilisi wall clock `HH:mm`. */
  arriveBy: string;
  /** ISO weekdays, 1 = Monday; missing = Mon–Fri. */
  days?: number[];
  /**
   * The ways ticked on the card (see packages/shared/src/ways.ts): the trip keeps
   * these and nothing else. Added later: older apps ignore it, and a newer app
   * without it (older server) plans the trip and ticks the best way itself.
   */
  ways?: RideStep[][];
  /** The plan the ways came from, so the card lists every way with its ticks. */
  plan?: PlanResponse;
}

/** What the assistant knows about a planned trip beyond coordinates: names the user would recognise, and when it repeats. */
export interface PlanTripMeta {
  /** Name for the saved trip, e.g. "University". */
  name?: string;
  from?: string;
  to?: string;
  /** ISO weekdays, 1 = Monday; missing = Mon–Fri. */
  days?: number[];
}

export interface ProposedEvent {
  title: string;
  /** ISO weekdays, 1 = Monday. */
  days: number[];
  /** `HH:mm`, Tbilisi. */
  start: string;
  end: string | null;
  /** Place as written in the source; resolved to coordinates when the user confirms. */
  place: string | null;
}

/** One ride of a proposed hand-built route, as the server checked it against TTC lines (names and lines from TTC, not the model). */
export interface ProposedRide {
  from: string;
  to: string;
  /** Lines that go from `from` to `to` and are not avoided. */
  routes: string[];
}

/** A trip with a route preference, opened in the New trip form for the user to check and save. */
export interface ProposedRoute extends ProposedTrip {
  /** ISO weekdays; missing = Mon–Fri. */
  days?: number[];
  avoid?: PlanAvoid;
  /** A hand-built route: the rides in order. */
  steps?: JourneyStep[];
  /** Same length as `steps`. */
  rides?: ProposedRide[];
}

/** One way of a plan card as plan_trip described it to the model: "direct 302", "321|335 -> metro 1". */
export interface PlanWay {
  label: string;
  /** Itinerary ids of this way, best first. */
  ids: string[];
}

export type ActionCard =
  /** `ways`: the plan's itineraries grouped by structure (groupWays), in the order the model was told ("way 1", "way 2"). Added later; the app groups the same way itself. */
  | { type: 'plan'; plan: PlanResponse; trip?: PlanTripMeta; ways?: PlanWay[] }
  | { type: 'arrivals'; stop: { id: string; name: string }; arrivals: Arrival[] }
  | { type: 'stops'; stops: StopHit[] }
  | { type: 'confirm_trip'; trip: ProposedTrip }
  | { type: 'confirm_events'; events: ProposedEvent[] }
  | { type: 'confirm_route'; route: ProposedRoute };

export interface ChatResponse {
  /** One short sentence; the cards carry the content. */
  reply: string;
  cards: ActionCard[];
}
