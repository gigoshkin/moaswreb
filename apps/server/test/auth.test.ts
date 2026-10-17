import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';

// Each test file runs in its own process, so config sees this key.
process.env.API_KEY = 'secret-key';
const { requireKey } = await import('../src/auth.ts');

test('requireKey accepts the bearer key and rejects anything else', async () => {
  const app = Fastify();
  app.post('/x', { preHandler: requireKey }, async () => ({ ok: true }));
  const call = (auth?: string) => app.inject({ method: 'POST', url: '/x', headers: auth ? { authorization: auth } : {} });
  assert.equal((await call('Bearer secret-key')).statusCode, 200);
  assert.equal((await call('Bearer wrong')).statusCode, 401);
  assert.equal((await call()).statusCode, 401);
});
