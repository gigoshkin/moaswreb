// The route model (ways, structure, grouping, kept ways) lives in
// packages/shared/src/ways.ts, so the app, the chat and the server use one
// implementation. This file only re-exports it for the app's imports.

export {
  NEAR_M, bestWay, cardKept, chainOf, defaultKept, fitsWay, groupWays, isTicked, namesWay, sameWay, slotsFor, structureOf, toggleWay, tripWays,
  variantSteps, wayKey, wayLabel, waysFields,
} from '@transit/shared';
export type { RideStep, Way } from '@transit/shared';
