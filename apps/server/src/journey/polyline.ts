import type { LatLon } from '@transit/shared';

/** Points → Google encoded polyline (the format the app already decodes). */
export function encodePolyline(points: LatLon[]): string {
  let out = '';
  let lat = 0;
  let lon = 0;
  const put = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    while (n >= 0x20) {
      out += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    out += String.fromCharCode(n + 63);
  };
  for (const p of points) {
    const la = Math.round(p.lat * 1e5);
    const lo = Math.round(p.lon * 1e5);
    put(la - lat);
    put(lo - lon);
    lat = la;
    lon = lo;
  }
  return out;
}
