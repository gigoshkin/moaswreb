// Roughly TTC's geocode bbox, padded. Rejects swapped lat/lon early.
const TBILISI = { minLat: 41.55, maxLat: 41.9, minLon: 44.6, maxLon: 45.1 };

export const insideTbilisi = (lat: number, lon: number): boolean =>
  lat >= TBILISI.minLat && lat <= TBILISI.maxLat && lon >= TBILISI.minLon && lon <= TBILISI.maxLon;
