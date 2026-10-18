import { persisted } from './store';
import { listTrips } from './trips';

// Installs that already have trips (updating testers) never see the intro. Bump the key to show it again.
const existing = listTrips().length > 0;

/** True once the intro was finished or skipped. */
export const introSeen = persisted<boolean>('intro:v1', existing);

/** True once the user was offered notifications (intro screen 3, or an install from before the intro). Until then the root layout must not prompt. */
export const alertsOffered = persisted<boolean>('intro:alerts', existing);

export const finishIntro = (offeredAlerts: boolean) => {
  if (offeredAlerts) alertsOffered.set(true);
  introSeen.set(true);
};

/** Settings -> Replay intro. */
export const replayIntro = () => introSeen.set(false);
