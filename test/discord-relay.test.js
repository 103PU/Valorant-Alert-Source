const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');

const { buildReleaseNotice } = require('../scripts/discord-release-notice');

// The Worker is an ES module because that is the only module format Cloudflare's
// module-worker format accepts; this suite is CommonJS like the rest of the repo,
// so it reaches the handler through a dynamic import. No miniflare, no vitest, no
// new dependency: `fetch`, `Request` and `Response` are Node globals, which is
// most of what a Worker runtime is from the handler's point of view.
const workerUrl = pathToFileURL(
  path.join(__dirname, '..', 'tools', 'discord-relay', 'worker.mjs')
).href;

const BOT_TOKEN = 'bot-token-not-a-real-one';
const TWEAKS_TOKEN = 'tweaks-relay-token-not-a-real-one';
const ALERT_TOKEN = 'alert-relay-token-not-a-real-one';
const TWEAKS_CHANNEL_ID = '1234567890123456789';
const ALERT_CHANNEL_ID = '1555280650096087150';
const ROUTES = {
  'valorant-tweaks': {
    channelBinding: 'DISCORD_CHANNEL_ID',
    tokenBinding: 'AUTH_TOKEN',
    crosspost: true
  },
  'valorant-alert': {
    channelId: ALERT_CHANNEL_ID,
    tokenBinding: 'ALERT_AUTH_TOKEN'
  }
};

const fullEnv = () => ({
  AUTH_TOKEN: TWEAKS_TOKEN,
  ALERT_AUTH_TOKEN: ALERT_TOKEN,
  DISCORD_BOT_TOKEN: BOT_TOKEN,
  DISCORD_CHANNEL_ID: TWEAKS_CHANNEL_ID,
  DISCORD_ROUTES: ROUTES
});

/**
 * Runs the handler with `fetch` swapped for a recorder, so nothing in this file
 * can reach Discord. Restores on throw as well, or one failing assertion would
 * leak the stub into every test after it.
 */
async function call(request, env, discord = { status: 200, body: '{"id":"999"}' }) {
  const worker = (await import(workerUrl)).default;
  const calls = [];
  const replies = Array.isArray(discord) ? discord : [discord];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    const body = reply.status === 204 ? null : reply.body;
    return new Response(body, { status: reply.status });
  };
  try {
    const res = await worker.fetch(request, env);
    return { res, body: await res.json(), calls };
  } finally {
    globalThis.fetch = original;
  }
}

const post = (body, route = 'valorant-alert', token = ALERT_TOKEN) =>
  new Request('https://relay.test/', {
    method: 'POST',
    headers: { 'x-auth-token': token, 'x-discord-route': route },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });

const notice = () => buildReleaseNotice({ tag: 'v1.0.0', repo: '103PU/Valorant-Alert-Release' });

// --- configuration is fail-closed -------------------------------------------

test('/health names missing route secrets and never their values', async () => {
  const req = new Request('https://relay.test/health');
  const { res, body } = await call(req, {
    DISCORD_BOT_TOKEN: BOT_TOKEN,
    DISCORD_CHANNEL_ID: TWEAKS_CHANNEL_ID,
    DISCORD_ROUTES: ROUTES
  });
  assert.equal(res.status, 503);
  assert.equal(body.configured, false);
  assert.deepEqual(body.missing, ['valorant-tweaks:AUTH_TOKEN', 'valorant-alert:ALERT_AUTH_TOKEN']);
  assert.ok(!JSON.stringify(body).includes(TWEAKS_TOKEN));
  assert.ok(!JSON.stringify(body).includes(ALERT_TOKEN));
});

test('/health is 200 once every binding is present', async () => {
  const { res, body } = await call(new Request('https://relay.test/health'), fullEnv());
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
});

test('an unconfigured relay refuses a POST before looking at the token', async () => {
  const { res, body, calls } = await call(post(notice()), {});
  assert.equal(res.status, 503);
  assert.equal(body.error, 'relay_not_configured');
  assert.equal(calls.length, 0);
});

test('GET / is 405 — only POST sends', async () => {
  const { res } = await call(new Request('https://relay.test/'), fullEnv());
  assert.equal(res.status, 405);
});

// --- auth --------------------------------------------------------------------

test('a wrong route token is 401 and never reaches Discord', async () => {
  const { res, body, calls } = await call(post(notice(), 'valorant-alert', 'wrong'), fullEnv());
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
  assert.ok(!JSON.stringify(body).includes(ALERT_TOKEN), 'the expected token must not leak');
});

test('a correct prefix is still 401', async () => {
  const { res } = await call(
    post(notice(), 'valorant-alert', ALERT_TOKEN.slice(0, -1)), fullEnv()
  );
  assert.equal(res.status, 401);
});

test('a missing route header is 400, not a crash', async () => {
  const { res } = await call(
    new Request('https://relay.test/', {
      method: 'POST',
      headers: { 'x-auth-token': ALERT_TOKEN },
      body: JSON.stringify(notice())
    }),
    fullEnv()
  );
  assert.equal(res.status, 400);
});

test('an unknown route is rejected before contacting Discord', async () => {
  const { res, body, calls } = await call(post(notice(), 'unknown-app'), fullEnv());
  assert.equal(res.status, 404);
  assert.equal(body.error, 'unknown_route');
  assert.equal(calls.length, 0);
});

test('a token for another route cannot send to this route', async () => {
  const { res, calls } = await call(post(notice(), 'valorant-alert', TWEAKS_TOKEN), fullEnv());
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
});

test('an unset app token does not block another configured route', async () => {
  const env = fullEnv();
  delete env.ALERT_AUTH_TOKEN;
  const { res, calls } = await call(post(notice(), 'valorant-tweaks', TWEAKS_TOKEN), env);
  assert.equal(res.status, 200);
  assert.equal(calls.length, 2);
});

// --- body validation ---------------------------------------------------------

test('an empty body is 413, not an empty message in the channel', async () => {
  const req = new Request('https://relay.test/', {
    method: 'POST', headers: { 'x-auth-token': ALERT_TOKEN, 'x-discord-route': 'valorant-alert' }
  });
  const { res, body } = await call(req, fullEnv());
  assert.equal(res.status, 413);
  assert.equal(body.error, 'bad_body_size');
});

test('a body past the size bound is 413', async () => {
  const { res } = await call(post({ embeds: [{ description: 'x'.repeat(70 * 1024) }] }), fullEnv());
  assert.equal(res.status, 413);
});

test('malformed JSON is 400', async () => {
  const { res, body } = await call(post('{"embeds":'), fullEnv());
  assert.equal(res.status, 400);
  assert.equal(body.error, 'invalid_json');
});

test('a payload with no embeds is refused here, not by Discord', async () => {
  const { res, body, calls } = await call(post({ content: 'hi' }), fullEnv());
  assert.equal(res.status, 400);
  assert.equal(body.error, 'embeds_required');
  assert.equal(calls.length, 0);
});

// --- the send ----------------------------------------------------------------

test('the Alert notice is posted to its configured channel', async () => {
  const { res, body, calls } = await call(post(notice()), fullEnv());
  assert.equal(res.status, 200);
  assert.equal(body.messageId, '999');
  assert.equal(body.channelId, ALERT_CHANNEL_ID);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://discord.com/api/v10/channels/${ALERT_CHANNEL_ID}/messages`);
  assert.equal(calls[0].init.headers.authorization, `Bot ${BOT_TOKEN}`);
  // The buttons are the whole reason a bot sends this instead of a webhook.
  assert.equal(JSON.parse(calls[0].init.body).components[0].components.length, 3);
});

test('the Tweaks route retains its existing channel and crosspost behavior', async () => {
  const { res, body, calls } = await call(post(notice(), 'valorant-tweaks', TWEAKS_TOKEN), fullEnv());
  assert.equal(res.status, 200);
  assert.equal(body.channelId, TWEAKS_CHANNEL_ID);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, `https://discord.com/api/v10/channels/${TWEAKS_CHANNEL_ID}/messages`);
  assert.equal(calls[1].url, `https://discord.com/api/v10/channels/${TWEAKS_CHANNEL_ID}/messages/999/crosspost`);
});

test('a crosspost failure does not turn a delivered message into a retryable failure', async () => {
  const { res, body, calls } = await call(post(notice(), 'valorant-tweaks', TWEAKS_TOKEN), fullEnv(), [
    { status: 200, body: '{"id":"999"}' },
    { status: 403, body: '{"message":"Missing Permissions"}' }
  ]);
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.crossposted, false);
  assert.equal(body.crosspostStatus, 403);
  assert.equal(calls.length, 2);
});

test('the Alert route does not crosspost to a regular text channel', async () => {
  const { calls } = await call(post(notice()), fullEnv());
  assert.equal(calls.length, 1);
});

test('a payload cannot redirect the message to another channel', async () => {
  const hijack = { ...notice(), channel_id: '999999999999999999' };
  const { calls } = await call(post(hijack), fullEnv());
  assert.equal(calls[0].url, `https://discord.com/api/v10/channels/${ALERT_CHANNEL_ID}/messages`);
  assert.equal(JSON.parse(calls[0].init.body).channel_id, undefined);
});

test('failed notices do not delete existing channel messages', async () => {
  const { calls } = await call(post(notice()), fullEnv());
  assert.equal(calls.every(({ init }) => init.method !== 'DELETE'), true);
});

test('mentions are forced off, so no payload can @everyone', async () => {
  const shouty = { ...notice(), allowed_mentions: { parse: ['everyone'] } };
  const { calls } = await call(post(shouty), fullEnv());
  assert.deepEqual(JSON.parse(calls[0].init.body).allowed_mentions, { parse: [] });
});

// --- Discord's failures ------------------------------------------------------

test('a 429 stays a 429 so retry_after survives', async () => {
  const { res, body } = await call(post(notice()), fullEnv(), {
    status: 429, body: '{"retry_after":4.2}'
  });
  assert.equal(res.status, 429);
  assert.match(body.discord, /retry_after/);
});

test('a Discord rejection is a 502 that quotes Discord, not the credential', async () => {
  const { res, body } = await call(post(notice()), fullEnv(), {
    status: 403, body: '{"message":"Missing Permissions","code":50013}'
  });
  assert.equal(res.status, 502);
  assert.equal(body.status, 403);
  assert.match(body.discord, /Missing Permissions/);
  const serialized = JSON.stringify(body);
  assert.ok(!serialized.includes(BOT_TOKEN) && !serialized.includes(TWEAKS_TOKEN));
  assert.ok(!serialized.includes(ALERT_TOKEN));
});

test('pruning deletes a single previous message with fallback DELETE', async () => {
  const req = new Request('https://relay.test/', {
    method: 'POST',
    headers: {
      'x-auth-token': ALERT_TOKEN,
      'x-discord-route': 'valorant-alert',
      'x-discord-prune': 'true'
    },
    body: JSON.stringify(notice())
  });

  const responses = [
    // 1. POST message
    { status: 200, body: JSON.stringify({ id: 'new_msg', author: { id: 'bot_1' } }) },
    // 2. GET messages
    {
      status: 200,
      body: JSON.stringify([
        { id: 'new_msg', author: { id: 'bot_1' }, timestamp: new Date().toISOString() },
        { id: 'old_msg_1', author: { id: 'bot_1' }, timestamp: new Date().toISOString() }
      ])
    },
    // 3. DELETE single message
    { status: 204, body: '' }
  ];

  const { res, body, calls } = await call(req, fullEnv(), responses);
  assert.equal(res.status, 200);
  assert.equal(body.pruned, 1);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].init.method, 'DELETE');
  assert.ok(calls[2].url.includes('old_msg_1'));
});
