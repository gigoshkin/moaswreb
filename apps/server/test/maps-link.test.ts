import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectMapsInput, isAllowedMapsUrl, mapsLinkToPlaces, parseMapsUrl, resolveMapsUrl } from '../src/chat/maps-link.ts';
import { PlanService } from '../src/plan/service.ts';
import { createTools } from '../src/tools/index.ts';
import { StopIndex } from '../src/ttc/stops.ts';
import { fakeTtc } from './fakes.ts';

const redirect = (map: Record<string, string>, seen: string[] = []): typeof fetch =>
  (async (url: string) => {
    seen.push(String(url));
    const loc = map[String(url)];
    return loc ? new Response(null, { status: 302, headers: { location: loc } }) : new Response('ok', { status: 200 });
  }) as unknown as typeof fetch;

test('dir link with coordinates gives origin and destination', () => {
  const l = parseMapsUrl('https://www.google.com/maps/dir/41.7151,44.8271/41.7201,44.8001/@41.71,44.81,14z');
  assert.equal(l?.kind, 'dir');
  assert.deepEqual(l?.places.map((p) => [p.lat, p.lng]), [[41.7151, 44.8271], [41.7201, 44.8001]]);
});

test('dir link with names takes the !3d!4d pins', () => {
  const l = parseMapsUrl('https://www.google.com/maps/dir/Liberty+Square,+Tbilisi/Vake+Park/@41.72,44.8,13z/data=!4m4!4m3!1m0!1m0!3e3!3d41.69!4d44.8!3d41.71!4d44.75');
  assert.equal(l?.places[0]?.label, 'Liberty Square, Tbilisi');
  assert.equal(l?.places.length, 2);
});

test('dir link with names only leaves coordinates unknown', () => {
  const l = parseMapsUrl('https://www.google.com/maps/dir/Vake+Park/Rustaveli+Avenue');
  assert.deepEqual(l?.places.map((p) => [p.label, p.lat]), [['Vake Park', null], ['Rustaveli Avenue', null]]);
});

test('place link prefers !3d!4d over @', () => {
  const l = parseMapsUrl('https://www.google.com/maps/place/Vake+Park/@41.7100,44.7600,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x1!8m2!3d41.7111!4d44.7622');
  assert.deepEqual(l?.places[0], { label: 'Vake Park', lat: 41.7111, lng: 44.7622 });
});

test('place with @ only, q= lat,lng, destination= and api=1 forms', () => {
  assert.equal(parseMapsUrl('https://www.google.com/maps/place/Tbilisi+Mall/@41.7,44.8,15z')?.places[0]?.lat, 41.7);
  assert.deepEqual(parseMapsUrl('https://maps.google.com/?q=41.72,44.78')?.places[0], { label: '41.72,44.78', lat: 41.72, lng: 44.78 });
  assert.equal(parseMapsUrl('https://www.google.com/maps/place/X?q=41.72,44.78')?.places[0]?.lat, 41.72);
  const d = parseMapsUrl('https://www.google.com/maps/dir/?api=1&origin=41.7,44.8&destination=Rustaveli+Metro');
  assert.deepEqual(d?.places.map((p) => p.label), ['41.7,44.8', 'Rustaveli Metro']);
  assert.equal(parseMapsUrl('https://www.google.com/maps')?.places, undefined);
});

test('detects links and bare coordinates in a message, trims punctuation', () => {
  const r = detectMapsInput('go from 41.7151, 44.8271 to https://maps.app.goo.gl/AbC123. thanks https://evil.example/maps');
  assert.deepEqual(r.urls, ['https://maps.app.goo.gl/AbC123']);
  assert.equal(r.points[0]?.lat, 41.7151);
  assert.equal(detectMapsInput('call 555 123').points.length, 0);
});

test('allowlist rejects http, other hosts, IPs, ports, credentials, lookalikes', () => {
  for (const u of [
    'http://maps.app.goo.gl/x', 'https://evil.com/maps/dir/a/b', 'https://127.0.0.1/maps', 'https://169.254.169.254/',
    'https://maps.app.goo.gl:8443/x', 'https://user:pw@maps.app.goo.gl/x', 'https://maps.app.goo.gl.evil.com/x',
    'https://www.google.com/search?q=1', 'https://notgoogle.com/maps/x', 'file:///etc/passwd',
  ]) assert.equal(isAllowedMapsUrl(u), null, u);
  assert.ok(isAllowedMapsUrl('https://www.google.com/maps/dir/a/b'));
  assert.ok(isAllowedMapsUrl('https://maps.google.com/?q=1,2'));
});

test('short link resolves through redirects to a long url', async () => {
  const seen: string[] = [];
  const f = redirect({ 'https://maps.app.goo.gl/abc': 'https://goo.gl/maps/x', 'https://goo.gl/maps/x': 'https://www.google.com/maps/place/Vake+Park/@41.71,44.76,17z' }, seen);
  const l = await mapsLinkToPlaces('https://maps.app.goo.gl/abc', f);
  assert.equal(l?.places[0]?.label, 'Vake Park');
  assert.equal(seen.length, 2);
});

test('redirect to a disallowed host, http, or too many hops is refused', async () => {
  assert.equal(await resolveMapsUrl('https://maps.app.goo.gl/a', redirect({ 'https://maps.app.goo.gl/a': 'https://evil.com/x' })), null);
  assert.equal(await resolveMapsUrl('https://maps.app.goo.gl/a', redirect({ 'https://maps.app.goo.gl/a': 'http://www.google.com/maps/dir/a/b' })), null);
  assert.equal(await resolveMapsUrl('https://maps.app.goo.gl/a', redirect({ 'https://maps.app.goo.gl/a': 'https://127.0.0.1/' })), null);
  const loop = redirect({ 'https://goo.gl/1': 'https://goo.gl/2', 'https://goo.gl/2': 'https://goo.gl/3', 'https://goo.gl/3': 'https://goo.gl/4', 'https://goo.gl/4': 'https://goo.gl/5' });
  assert.equal(await resolveMapsUrl('https://goo.gl/1', loop), null);
  const f3 = redirect({ 'https://goo.gl/1': 'https://goo.gl/2', 'https://goo.gl/2': 'https://goo.gl/3', 'https://goo.gl/3': 'https://www.google.com/maps/dir/a/b' });
  assert.ok(await resolveMapsUrl('https://goo.gl/1', f3));
});

test('fetch errors and timeouts give null', async () => {
  const boom = (async () => { throw new Error('net'); }) as unknown as typeof fetch;
  assert.equal(await mapsLinkToPlaces('https://maps.app.goo.gl/a', boom), null);
});

test('parse_maps_link tool: dir link, short link and no link; never hits the network without an injected fetch', async () => {
  const ttc = fakeTtc();
  const stops = new StopIndex(ttc);
  const f = redirect({ 'https://maps.app.goo.gl/z': 'https://www.google.com/maps/dir/41.7151,44.8271/41.7201,44.8001' });
  const tool = createTools({ ttc, stops, plans: new PlanService(ttc, stops), fetch: f }).find((t) => t.name === 'parse_maps_link')!;
  const run = (text: string) => tool.run(tool.schema.parse({ text }) as never);
  assert.equal(tool.mcp, false);
  const r = await run('how do I get here https://maps.app.goo.gl/z');
  assert.match(r.text, /origin \| "41.7151,44.8271" \| 41.7151,44.8271/);
  assert.match(r.text, /destination .* 41.7201,44.8001/);
  assert.match(r.text, /^origin/);
  assert.match((await run('hello')).text, /No Google Maps link/);
  assert.match((await run('41.9000, 44.8000')).text, /outside Tbilisi|41.9/);
  assert.match((await run('https://www.google.com/maps/dir/Vake/Saburtalo')).text, /coords unknown/);
});
