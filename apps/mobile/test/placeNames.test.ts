/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DROPPED_PIN, isDropped, pinLabel, within } from '../src/lib/placeNames.ts';

test('a pin takes the address the lookup found', () => {
  assert.equal(pinLabel({ name: 'Anna Politkovskaya Street 42' }, [{ name: 'Metro', distanceM: 20 }]), 'Anna Politkovskaya Street 42');
  assert.equal(pinLabel({ name: '  Rustaveli Ave  ' }, null), 'Rustaveli Ave');
});

test('without an address the closest stop within 400 m names the pin', () => {
  const stops = [
    { name: 'Far stop', distanceM: 380 },
    { name: 'Close stop', distanceM: 90 },
  ];
  assert.equal(pinLabel(null, stops), 'Near Close stop');
  assert.equal(pinLabel({ name: '' }, stops), 'Near Close stop', 'an empty name is no name');
  assert.equal(pinLabel(null, [{ name: 'Too far', distanceM: 401 }]), DROPPED_PIN);
  assert.equal(pinLabel(null, [{ name: ' ', distanceM: 5 }]), DROPPED_PIN);
});

test('with nothing known it stays "Dropped pin"', () => {
  assert.equal(pinLabel(null, []), DROPPED_PIN);
  assert.equal(pinLabel(undefined, undefined), DROPPED_PIN);
});

test('only the placeholder counts as unnamed', () => {
  assert.ok(isDropped('Dropped pin') && isDropped(' dropped PIN '));
  assert.ok(!isDropped('Near Liberty Square') && !isDropped('Home') && !isDropped('') && !isDropped(undefined));
});

test('within gives the value in time, undefined when late or failed', async () => {
  assert.equal(await within(Promise.resolve('a'), 50), 'a');
  assert.equal(await within(new Promise((r) => setTimeout(() => r('slow'), 200)), 20), undefined);
  assert.equal(await within(Promise.reject(new Error('x')), 50), undefined);
});
