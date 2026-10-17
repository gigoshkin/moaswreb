/** "350 m", "1.2 km". */
export const distanceLabel = (m: number): string => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
