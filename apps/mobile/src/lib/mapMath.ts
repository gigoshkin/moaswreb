import type { LatLon } from '@transit/shared';

// Web-mercator maths shared by the static and the interactive map. "Normalised"
// coordinates run 0..1 across the world, so a view is just (nx, ny, zoom).

/** Points per tile. The tiles are 256 px, so each is drawn at 128 pt and stays sharp on 2x/3x screens. */
export const TILE = 128;
export const MAX_ZOOM = 16.4;
export const MIN_ZOOM = 10;

/** Esri's muted "Light Gray Canvas": no API key, works in Expo Go. Tile zoom tops out at 16. */
export const tileUrl = (z: number, x: number, y: number) => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/${z}/${y}/${x}`;

export const normX = (lon: number) => (lon + 180) / 360;
export const normY = (lat: number) => {
  const r = (lat * Math.PI) / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
};
export const lonOf = (nx: number) => nx * 360 - 180;
export const latOf = (ny: number) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * ny))) * 180) / Math.PI;

/** Points on screen per unit of normalised coordinate at a zoom. (`scaleAt` and `clamp` run inside gesture and style worklets, hence the directive.) */
export const scaleAt = (zoom: number) => {
  'worklet';
  return TILE * 2 ** zoom;
};

export interface View {
  nx: number;
  ny: number;
  zoom: number;
}

export const viewOf = (center: LatLon, zoom: number): View => ({ nx: normX(center.lon), ny: normY(center.lat), zoom });

export const clamp = (v: number, lo: number, hi: number) => {
  'worklet';
  return Math.min(hi, Math.max(lo, v));
};

/** The view that frames `points` inside a `width` × `height` box with `pad` kept clear on each side. */
export function fitView(points: LatLon[], width: number, height: number, pad: { top: number; right: number; bottom: number; left: number }): View {
  const xs = points.map((p) => normX(p.lon));
  const ys = points.map((p) => normY(p.lat));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const availW = Math.max(40, width - pad.left - pad.right);
  const availH = Math.max(40, height - pad.top - pad.bottom);
  const spanX = Math.max(maxX - minX, 1e-9);
  const spanY = Math.max(maxY - minY, 1e-9);
  const zoom = clamp(Math.log2(Math.min(availW / (spanX * TILE), availH / (spanY * TILE))), MIN_ZOOM, 16);
  return { nx: (minX + maxX) / 2, ny: (minY + maxY) / 2, zoom };
}

/** Google encoded polyline → points. */
export function decodePolyline(s: string): LatLon[] {
  const out: LatLon[] = [];
  let i = 0;
  let lat = 0;
  let lon = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = s.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && i < s.length);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < s.length) {
    lat += next();
    lon += next();
    out.push({ lat: lat / 1e5, lon: lon / 1e5 });
  }
  return out;
}
