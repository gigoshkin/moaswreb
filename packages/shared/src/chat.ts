// Chat input (request 0001): one chat screen takes text, photos and PDFs and
// answers with action cards. Numbers in cards always come from code (TTC data),
// never from the model. Proposals (trips, events) are confirmed by the user and
// stored on the phone; the server keeps no user data.

import type { LatLon, PlanResponse } from './plan.ts';

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

export type ActionCard =
  | { type: 'plan'; plan: PlanResponse }
  | { type: 'arrivals'; stop: { id: string; name: string }; arrivals: Arrival[] }
  | { type: 'stops'; stops: StopHit[] }
  | { type: 'confirm_trip'; trip: ProposedTrip }
  | { type: 'confirm_events'; events: ProposedEvent[] };

export interface ChatResponse {
  /** One short sentence; the cards carry the content. */
  reply: string;
  cards: ActionCard[];
}
