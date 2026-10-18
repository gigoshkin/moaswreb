import { readFile } from 'node:fs/promises';
import type { PatternRef, Source } from '../src/journey/source.ts';
import type { TtcClient } from '../src/ttc/client.ts';

export const rawPlan = JSON.parse(await readFile(new URL('./fixtures/plan-otp-synthetic.json', import.meta.url), 'utf8'));

// SYNTHETIC TTC data in the documented shapes (knowledge-base/ttc-pis-gateway-api.md).
const stopsKa = [
  { id: '1:1405', code: '1405', name: 'თავისუფალი უნივერსიტეტი', lat: 41.7099, lon: 44.7929, vehicleMode: 'BUS' },
  { id: '1:1000', code: '1000', name: 'რუსთაველის გამზირი', lat: 41.7012, lon: 44.7975, vehicleMode: 'BUS' },
  { id: '1:3000', code: null, name: 'სადგურის მოედანი', lat: 41.72, lon: 44.8, vehicleMode: 'SUBWAY' },
];
const stopsEn = [
  { ...stopsKa[0], name: 'Free University' },
  { ...stopsKa[1], name: 'Rustaveli Avenue' },
  { ...stopsKa[2], name: 'Station Square' },
];

export const fakeTtc = (): TtcClient & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    stops: async (locale: string) => (calls.push(`stops:${locale}`), locale === 'en' ? stopsEn : stopsKa),
    arrivalTimes: async (id: string) => (
      calls.push(`arrivals:${id}`),
      [
        { shortName: '347', color: '1E88E5', headsign: 'Vake', patternSuffix: '0:01', vehicleMode: 'BUS', realtime: true, realtimeArrivalMinutes: 4, scheduledArrivalMinutes: 67 },
        { shortName: '306', color: 'E02B2B', headsign: 'Saburtalo', patternSuffix: '0:01', vehicleMode: 'BUS', realtime: true, realtimeArrivalMinutes: 2, scheduledArrivalMinutes: -35 },
        { shortName: '558', color: '', headsign: 'Didube', patternSuffix: '0:01', vehicleMode: 'BUS', realtime: false, realtimeArrivalMinutes: 0, scheduledArrivalMinutes: 11 },
      ]
    ),
    geocode: async (q: string) => (
      calls.push(`geocode:${q}`),
      { features: [{ geometry: { coordinates: [44.7712, 41.7286] }, properties: { name: 'Delisi' } }] }
    ),
    plan: async () => (calls.push('plan'), rawPlan),
  } as unknown as TtcClient & { calls: string[] };
};

// SYNTHETIC lines for lines_at_stop / propose_route: 306 Free University → Rustaveli → Station Square, minibus 518 Free University → Station Square.
const ref = (id: string) => ({ id, name: stopsEn.find((s) => s.id === id)!.name, lat: 0, lon: 0 });
const pattern = (shortName: string, ids: string[], minibus = false): PatternRef => ({
  routeId: minibus ? `1:minibus${shortName}` : `1:R${shortName}`, shortName, longName: null, color: null, minibus, mode: 'BUS', suffix: '0:01',
  headsign: minibus ? null : 'Station', stops: ids.map(ref),
});
const patterns = [pattern('306', ['1:1405', '1:1000', '1:3000']), pattern('518', ['1:1405', '1:3000'], true)];

export const fakeSource = (): Pick<Source, 'patternsAt'> => ({
  patternsAt: async (id) => patterns.filter((p) => p.stops.some((s) => s.id === id)),
});
