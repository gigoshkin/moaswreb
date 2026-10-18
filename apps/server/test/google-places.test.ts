import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PlaceHit } from '@transit/shared';
import { createGoogleSearch } from '../src/ttc/google-places.ts';
import { findPlaces } from '../src/ttc/lookups.ts';
import type { StreetGeo } from '../src/ttc/photon.ts';
import { fakeTtc } from './fakes.ts';

const place = (text: string, lat: number, lon: number) => ({
  displayName: { text },
  formattedAddress: `${text}, Tbilisi, Georgia`,
  location: { latitude: lat, longitude: lon },
  types: ['restaurant', 'food'],
});

/** A scripted stand-in for Places API (New). Nothing here touches the network. */
const scripted = (respond: () => Response | Promise<Response> = () => new Response(JSON.stringify({ places: [place('Cafe Linville', 41.7, 44.8)] }), { status: 200 })) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const doFetch = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return respond();
  };
  return { doFetch: doFetch as typeof fetch, calls };
};

const make = (s: ReturnType<typeof scripted>, over: { dailyCap?: number; now?: () => number } = {}) =>
  createGoogleSearch({ key: 'test-key', dailyCap: over.dailyCap ?? 500, fetch: s.doFetch, now: over.now, log: () => {} });

test('Google: places map to PlaceHit', async () => {
  const s = scripted();
  const hits = await make(s)('linville');
  assert.deepEqual(hits, [{ name: 'Cafe Linville', address: 'Cafe Linville, Tbilisi, Georgia', lat: 41.7, lon: 44.8, kind: 'restaurant' }]);
});

test('Google: request carries the key header, field mask and Tbilisi restriction', async () => {
  const s = scripted();
  await make(s)('Archil Mefe 7', 4);
  const { url, init } = s.calls[0];
  assert.equal(url, 'https://places.googleapis.com/v1/places:searchText');
  assert.equal(init.method, 'POST');
  const h = init.headers as Record<string, string>;
  assert.equal(h['X-Goog-Api-Key'], 'test-key');
  assert.equal(h['X-Goog-FieldMask'], 'places.displayName,places.formattedAddress,places.location,places.types');
  const body = JSON.parse(String(init.body));
  assert.equal(body.textQuery, 'Archil Mefe 7');
  assert.equal(body.languageCode, 'en');
  assert.equal(body.regionCode, 'GE');
  assert.equal(body.maxResultCount, 4);
  assert.deepEqual(body.locationRestriction.rectangle.low, { latitude: 41.55, longitude: 44.6 });
});

test('Google: a repeated query is served from the cache', async () => {
  const s = scripted();
  const search = make(s);
  await search('Rustaveli');
  const again = await search('  RUSTAVELI ');
  assert.equal(s.calls.length, 1);
  assert.equal(again.length, 1);
});

test('Google: identical in-flight queries share one call', async () => {
  const s = scripted();
  const search = make(s);
  await Promise.all([search('vake park'), search('vake park')]);
  assert.equal(s.calls.length, 1);
});

test('Google: the daily cap stops calls and resets the next Tbilisi day', async () => {
  const s = scripted();
  let t = Date.UTC(2026, 9, 18, 10, 0);
  const search = make(s, { dailyCap: 2, now: () => t });
  await search('aaa');
  await search('bbb');
  assert.deepEqual(await search('ccc'), []);
  assert.equal(s.calls.length, 2);
  t += 24 * 3_600_000;
  await search('ccc');
  assert.equal(s.calls.length, 3);
});

test('Google: queries under 3 characters make no call', async () => {
  const s = scripted();
  assert.deepEqual(await make(s)(' ab '), []);
  assert.equal(s.calls.length, 0);
});

test('Google: HTTP errors and network failures return nothing and are not cached', async () => {
  const bad = scripted(() => new Response('{}', { status: 403 }));
  const search = make(bad);
  assert.deepEqual(await search('tbilisi'), []);
  assert.deepEqual(await search('tbilisi'), []);
  assert.equal(bad.calls.length, 2);
  const down = scripted(() => Promise.reject(new Error('offline')));
  assert.deepEqual(await make(down)('tbilisi'), []);
});

const hit = (name: string, lat: number): PlaceHit => ({ name, address: null, lat, lon: 44.8, kind: null });

test('findPlaces: Google first, then TTC; Photon skipped when Google fills the limit', async () => {
  const ttc = { ...fakeTtc(), geocode: async () => ({ features: [{ geometry: { coordinates: [44.9, 41.8] }, properties: { name: 'TTC place' } }] }) } as any;
  let photonCalls = 0;
  const geo: StreetGeo = { search: async () => (photonCalls++, [hit('Photon place', 41.6)]), reverse: async () => null };
  const google = async () => [hit('G1', 41.7), hit('G2', 41.71)];
  const full = await findPlaces(ttc, 'x place', 'en', 2, geo, google);
  assert.deepEqual(full.map((p) => p.name), ['G1', 'G2', 'TTC place']);
  assert.equal(photonCalls, 0);
  const part = await findPlaces(ttc, 'x place', 'en', 5, geo, google);
  assert.deepEqual(part.map((p) => p.name), ['G1', 'G2', 'TTC place', 'Photon place']);
});

test('findPlaces: Google failing (empty) falls back to TTC and Photon', async () => {
  const ttc = { ...fakeTtc(), geocode: async () => ({ features: [] }) } as any;
  const geo: StreetGeo = { search: async () => [hit('Photon place', 41.6)], reverse: async () => null };
  const out = await findPlaces(ttc, 'x place', 'en', 5, geo, async () => []);
  assert.deepEqual(out.map((p) => p.name), ['Photon place']);
});

test('Google: abbreviations and the TTC spelling are spelled out before the search', async () => {
  const { tidyQuery } = await import('../src/ttc/google-places.ts');
  assert.equal(tidyQuery('7B Archil Mef St'), '7B Archil Mefe Street');
  assert.equal(tidyQuery('Archil Mepe st.'), 'Archil Mefe Street');
  assert.equal(tidyQuery('Rustaveli Ave'), 'Rustaveli Avenue');
  assert.equal(tidyQuery('Vake Park'), 'Vake Park');
  const s = scripted();
  await make(s)('7B Archil Mef St');
  assert.equal(JSON.parse(String(s.calls[0].init.body)).textQuery, '7B Archil Mefe Street');
});
