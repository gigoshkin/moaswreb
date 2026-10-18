import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { nameOfPlace } from './nameOfPlace';
import { isDropped } from './placeNames';
import type { Place } from './trips';

/**
 * Gives a "Dropped pin" place its real name once the lookup answers. `set` is
 * the state setter that holds the place; the new name is only applied if the
 * place is still at the same point and still unnamed.
 */
export function useNamedPlace(place: Place | null, set: Dispatch<SetStateAction<Place | null>>): void {
  const lat = place?.lat;
  const lon = place?.lon;
  const dropped = !!place && isDropped(place.label);
  useEffect(() => {
    if (!place || !dropped) return;
    let live = true;
    nameOfPlace(place).then((named) => {
      if (live && named !== place) set((cur) => (cur && cur.lat === lat && cur.lon === lon && isDropped(cur.label) ? named : cur));
    });
    return () => {
      live = false;
    };
  }, [lat, lon, dropped]); // eslint-disable-line react-hooks/exhaustive-deps
}
