import assert from 'node:assert/strict';
import { test } from 'node:test';
import { searchVariants } from '../src/ttc/photon.ts';

test('searchVariants cleans punctuation, "St" and the Mefe/Mepe slip', () => {
  assert.deepEqual(searchVariants('7B Archil Mefe St,'), ['7B Archil Mepe', 'Archil Mepe']);
});

test('searchVariants keeps a plain name as one query', () => {
  assert.deepEqual(searchVariants('Free University'), ['Free University']);
});
