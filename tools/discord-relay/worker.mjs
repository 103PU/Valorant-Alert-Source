// Cloudflare Worker: the Discord relay for Valorant Score Alert releases.
//
// Why a relay exists at all: the release notice carries `components` — the row of
// link buttons under the embed — and a Discord *webhook* silently drops them.
// Only a bot can render them, and a bot token must not live in a GitHub Actions
// step that prints its environment on failure. So CI POSTs the message here with
// a shared token, and this Worker re-sends it to Discord with the bot token.
//
// Why a SEPARATE Worker from the ValorantTweaks one, rather than reusing its URL:
// the payload deliberately carries NO channel id, so the destination channel is
// whatever this Worker says it is. Pointing CI at ValorantTweaks' relay would
// therefore post Valorant Alert's release into ValorantTweaks' channel. This
// Worker exists to own #valorant-alert and nothing else.
//
// Two security properties fall out of that choice, and they are the reason the
// channel is not a request field:
//   * A leaked RELAY_AUTH_TOKEN lets an attacker spam exactly one channel. It
//     does not turn our bot into a posting primitive for every channel the bot
//     can see.
//   * allowed_mentions is overwritten here, not trusted from the body, so no
//     payload — including one from compromised CI — can @everyone.
//
// Nothing in this file logs or returns a secret. Deploy notes: ./README.md.

const DISCORD_API = 'https://discord.com/api/v10';

// The notice is ~3 KB. This is a sanity bound, not a Discord limit: a body far
// past it means something other than our own workflow is calling.
const MAX_BODY_BYTES = 64 * 1024;

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function json(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
}

/**
 * Compares without an early exit on the first differing byte. JS strings and a
 * JIT make "constant time" a claim this cannot honestly make; the point is to
 * avoid the trivially measurable length-prefix compare that `===` gives you.
 */
function tokenMatches(presented, expected) {
  const a = new TextEncoder().encode(String(presented ?? ''));
  const b = new TextEncoder().encode(String(expected ?? ''));
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * A missing binding is a 503, not a 401 and not a crash: it separates "this
 * Worker is not configured yet" from "your token is wrong", which are the two
 * failures a first deploy actually hits. Fails closed either way — no branch
 * below reaches Discord without all three values present.
 */
function readEnv(env) {
  const missing = ['RELAY_AUTH_TOKEN', 'DISCORD_BOT_TOKEN', 'DISCORD_CHANNEL_ID']
    .filter((name) => !env[name]);
  return { missing };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // A smoke test that proves the deploy and the bindings without posting to the
    // channel. It names which bindings are missing but never their values, and it
    // needs no auth: the answer is already public information about the deploy.
    if (request.method === 'GET' && url.pathname === '/health') {
      const { missing } = readEnv(env);
      return json(missing.length ? 503 : 200, {
        ok: missing.length === 0,
        service: 'valorant-alert-discord-relay',
        configured: missing.length === 0,
        missing
      });
    }

    if (request.method !== 'POST') {
      return json(405, { ok: false, error: 'method_not_allowed' });
    }

    const { missing } = readEnv(env);
    if (missing.length) {
      return json(503, { ok: false, error: 'relay_not_configured', missing });
    }

    if (!tokenMatches(request.headers.get('x-auth-token'), env.RELAY_AUTH_TOKEN)) {
      return json(401, { ok: false, error: 'invalid_auth_token' });
    }

    const raw = await request.arrayBuffer();
    if (raw.byteLength === 0 || raw.byteLength > MAX_BODY_BYTES) {
      return json(413, { ok: false, error: 'bad_body_size', bytes: raw.byteLength });
    }

    let body;
    try {
      body = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      return json(400, { ok: false, error: 'invalid_json' });
    }

    // Validated here so a malformed payload fails the CI step instead of putting
    // an empty message in the channel. Discord would accept `{}` with a 400 that
    // is harder to read than this one.
    if (!Array.isArray(body.embeds) || body.embeds.length === 0) {
      return json(400, { ok: false, error: 'embeds_required' });
    }

    const message = {
      ...body,
      // Both overwritten last, so a body that tries to set them cannot win.
      channel_id: undefined,
      allowed_mentions: { parse: [] }
    };

    const sent = await fetch(`${DISCORD_API}/channels/${env.DISCORD_CHANNEL_ID}/messages`, {
      method: 'POST',
      headers: {
        ...JSON_HEADERS,
        authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        'user-agent': 'ValorantAlert-DiscordRelay (+https://github.com/103PU/Valorant-Alert-Source)'
      },
      body: JSON.stringify(message)
    });

    const text = await sent.text();

    if (!sent.ok) {
      // Discord's error body is safe to pass back — it describes the rejected
      // message, never the credential. `retry_after` on a 429 is the one field
      // an operator actually needs, so it survives verbatim.
      return json(sent.status === 429 ? 429 : 502, {
        ok: false,
        error: 'discord_rejected',
        status: sent.status,
        discord: text.slice(0, 1000)
      });
    }

    let messageId = null;
    try { messageId = JSON.parse(text).id ?? null; } catch { /* id is a nicety */ }

    // channelId is echoed on purpose: it is not a credential, and it is the one
    // value that tells you the notice landed where you meant it to.
    return json(200, { ok: true, messageId, channelId: env.DISCORD_CHANNEL_ID });
  }
};
