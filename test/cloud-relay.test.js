const test = require('node:test');
const assert = require('node:assert');
const CloudRelay = require('../server/transport/cloud-relay');

test('CloudRelay: skips broadcast if not entitled', async () => {
  let fetched = false;
  const relay = new CloudRelay({
    isEntitled: () => false,
    getSession: () => ({ jwt: 'valid-jwt', user: { id: 'u1' } }),
    fetchFn: async () => { fetched = true; return { ok: true }; }
  });

  await relay.broadcastScore({ inGame: true, alliedScore: 10, enemyScore: 8 });
  assert.strictEqual(fetched, false);
});

test('CloudRelay: skips broadcast if no user JWT', async () => {
  let fetched = false;
  const relay = new CloudRelay({
    isEntitled: () => true,
    getSession: () => ({ user: null, jwt: null }),
    fetchFn: async () => { fetched = true; return { ok: true }; }
  });

  await relay.broadcastScore({ inGame: true, alliedScore: 10, enemyScore: 8 });
  assert.strictEqual(fetched, false);
});

test('CloudRelay: sends POST with JWT header and payload when entitled', async () => {
  let callArgs = null;
  const fakeSession = { jwt: 'my-secret-jwt', user: { id: 'user-123', email: 'test@example.com' } };
  const relay = new CloudRelay({
    baseUrl: 'https://kld.test',
    isEntitled: () => true,
    getSession: () => fakeSession,
    fetchFn: async (url, opts) => {
      callArgs = { url, opts };
      return { ok: true };
    }
  });

  const scoreData = { inGame: true, alliedScore: 5, enemyScore: 3, round: 9, mapName: 'ASCENT', status: 'SAFE' };
  await relay.broadcastScore(scoreData);

  assert.ok(callArgs);
  assert.strictEqual(callArgs.url, 'https://kld.test/api/relay/score');
  assert.strictEqual(callArgs.opts.method, 'POST');
  assert.strictEqual(callArgs.opts.headers['Authorization'], 'Bearer my-secret-jwt');
  assert.strictEqual(callArgs.opts.headers['Content-Type'], 'application/json');

  const parsedBody = JSON.parse(callArgs.opts.body);
  assert.strictEqual(parsedBody.alliedScore, 5);
  assert.strictEqual(parsedBody.enemyScore, 3);
  assert.strictEqual(relay.connected, true);
  assert.ok(relay.lastSyncAt > 0);
});

test('CloudRelay: throttles duplicate payloads within minIntervalMs', async () => {
  let count = 0;
  const fakeSession = { jwt: 'my-secret-jwt', user: { id: 'user-123' } };
  const relay = new CloudRelay({
    isEntitled: () => true,
    getSession: () => fakeSession,
    minIntervalMs: 2000,
    fetchFn: async () => { count++; return { ok: true }; }
  });

  const scoreData = { inGame: true, alliedScore: 5, enemyScore: 3, round: 9, mapName: 'ASCENT', status: 'SAFE' };
  await relay.broadcastScore(scoreData);
  assert.strictEqual(count, 1);

  // Immediate second call with same score data should be throttled
  await relay.broadcastScore(scoreData);
  assert.strictEqual(count, 1);

  // State change (score changed) bypasses throttling
  const newScoreData = { inGame: true, alliedScore: 6, enemyScore: 3, round: 10, mapName: 'ASCENT', status: 'SAFE' };
  await relay.broadcastScore(newScoreData);
  assert.strictEqual(count, 2);
});

test('CloudRelay: handles network errors gracefully without crashing', async () => {
  const fakeSession = { jwt: 'my-jwt', user: { id: 'user-123' } };
  const relay = new CloudRelay({
    isEntitled: () => true,
    getSession: () => fakeSession,
    fetchFn: async () => { throw new Error('Network timeout'); }
  });

  await assert.doesNotReject(async () => {
    await relay.broadcastScore({ inGame: true, alliedScore: 1, enemyScore: 0 });
  });

  assert.strictEqual(relay.connected, false);
  assert.strictEqual(relay.lastError, 'Network timeout');
});

test('CloudRelay: getRelayWebUrl generates proper url with userId', () => {
  const relay = new CloudRelay({
    webBaseUrl: 'https://my-alert.pages.dev',
    getSession: () => ({ user: { id: 'uuid-456', name: 'Gamer' } })
  });

  const url = relay.getRelayWebUrl();
  assert.ok(url.startsWith('https://my-alert.pages.dev?mode=relay&userId=uuid-456'));
});
