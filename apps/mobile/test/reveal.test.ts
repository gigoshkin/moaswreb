/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REVEAL_MARGIN, revealDelta } from '../src/lib/reveal.ts';

test('a field is lifted only as far as the keyboard covers it', () => {
  assert.equal(revealDelta(500, 800), 0, 'clear of the keyboard');
  assert.equal(revealDelta(780, 800), 780 + REVEAL_MARGIN - 800, 'inside the margin above it');
  assert.equal(revealDelta(900, 800, 10), 110, 'under the keyboard');
});
