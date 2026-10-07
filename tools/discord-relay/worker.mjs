const DISCORD_API = 'https://discord.com/api/v10';
const MAX_BODY_BYTES = 64 * 1024;
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function json(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
}

async function tokenMatches(presented, expected) {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(String(presented ?? ''))),
    crypto.subtle.digest('SHA-256', encoder.encode(String(expected ?? '')))
  ]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

function readRoutes(env) {
  if (!env.DISCORD_ROUTES) return { error: 'missing_route_registry' };
  try {
    const routes = typeof env.DISCORD_ROUTES === 'string'
      ? JSON.parse(env.DISCORD_ROUTES)
      : env.DISCORD_ROUTES;
    if (!routes || typeof routes !== 'object' || Array.isArray(routes)) {
      return { error: 'invalid_route_registry' };
    }
    for (const [key, route] of Object.entries(routes)) {
      const validKey = /^[a-z0-9][a-z0-9-]{0,63}$/.test(key);
      const validRoute = route && typeof route === 'object' && !Array.isArray(route);
      const validTokenBinding = validRoute && /^[A-Z][A-Z0-9_]{1,63}$/.test(route.tokenBinding ?? '');
      const hasChannelId = validRoute && typeof route.channelId === 'string';
      const hasChannelBinding = validRoute && /^[A-Z][A-Z0-9_]{1,63}$/.test(route.channelBinding ?? '');
      if (!validKey || !validRoute || !validTokenBinding || hasChannelId === hasChannelBinding) {
        return { error: 'invalid_route_registry' };
      }
    }
    return { routes };
  } catch {
    return { error: 'invalid_route_registry' };
  }
}

function channelFor(env, route) {
  const channelId = route.channelId ?? env[route.channelBinding];
  return /^\d{17,20}$/.test(String(channelId ?? '')) ? String(channelId) : null;
}

function missingForRoute(env, route) {
  const missing = [];
  if (!env.DISCORD_BOT_TOKEN) missing.push('DISCORD_BOT_TOKEN');
  if (!env[route.tokenBinding]) missing.push(route.tokenBinding);
  if (!channelFor(env, route)) missing.push(route.channelBinding ?? 'channelId');
  return missing;
}

async function deleteSingleMessage(env, channelId, messageId) {
  let del = await fetch(`${DISCORD_API}/channels/${channelId}/messages/${messageId}`, {
    method: 'DELETE',
    headers: { authorization: `Bot ${env.DISCORD_BOT_TOKEN}` }
  });
  if (del.status === 429) {
    const retry = await del.json().catch(() => ({}));
    await new Promise(r => setTimeout(r, ((retry.retry_after ?? 1) + 0.1) * 1000));
    del = await fetch(`${DISCORD_API}/channels/${channelId}/messages/${messageId}`, {
      method: 'DELETE',
      headers: { authorization: `Bot ${env.DISCORD_BOT_TOKEN}` }
    });
  }
  return del.ok || del.status === 404;
}

async function prunePreviousMessages(env, channelId, botId, keepMessageId) {
  const resp = await fetch(`${DISCORD_API}/channels/${channelId}/messages?limit=100`, {
    headers: { authorization: `Bot ${env.DISCORD_BOT_TOKEN}` }
  });
  if (!resp.ok) return { pruned: 0, error: `fetch_${resp.status}` };

  const messages = await resp.json().catch(() => []);
  if (!Array.isArray(messages)) return { pruned: 0, error: 'invalid_messages_response' };

  const toDelete = messages.filter(m => m.author?.id === botId && m.id !== keepMessageId);
  if (toDelete.length === 0) return { pruned: 0 };

  const now = Date.now();
  const fourteenDays = 14 * 24 * 60 * 60 * 1000;
  const recent = toDelete.filter(m => now - new Date(m.timestamp).getTime() < fourteenDays);
  const old = toDelete.filter(m => now - new Date(m.timestamp).getTime() >= fourteenDays);

  let pruned = 0;
  const bulkDeletedIds = new Set();

  if (recent.length >= 2) {
    const bulkResp = await fetch(`${DISCORD_API}/channels/${channelId}/messages/bulk-delete`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
      body: JSON.stringify({ messages: recent.map(m => m.id) })
    });
    if (bulkResp.ok) {
      pruned += recent.length;
      recent.forEach(m => bulkDeletedIds.add(m.id));
    }
  }

  const remainingRecent = recent.filter(m => !bulkDeletedIds.has(m.id));
  for (const msg of remainingRecent) {
    if (await deleteSingleMessage(env, channelId, msg.id)) {
      pruned += 1;
    }
  }

  for (const msg of old) {
    if (await deleteSingleMessage(env, channelId, msg.id)) {
      pruned += 1;
    }
  }

  return { pruned };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const registry = readRoutes(env);

    if (request.method === 'GET' && url.pathname === '/health') {
      const missing = registry.error
        ? [registry.error]
        : Object.entries(registry.routes).flatMap(([key, route]) =>
          missingForRoute(env, route).map((binding) => `${key}:${binding}`));
      return json(missing.length ? 503 : 200, {
        ok: missing.length === 0,
        service: 'discord-proxy',
        configured: missing.length === 0,
        routes: registry.routes ? Object.keys(registry.routes) : [],
        missing
      });
    }

    if (request.method !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' });
    if (registry.error) return json(503, { ok: false, error: 'relay_not_configured', missing: [registry.error] });

    const routeKey = request.headers.get('x-discord-route');
    if (!routeKey) return json(400, { ok: false, error: 'discord_route_required' });
    if (!Object.hasOwn(registry.routes, routeKey)) return json(404, { ok: false, error: 'unknown_route' });
    const route = registry.routes[routeKey];

    const missing = missingForRoute(env, route);
    if (missing.length) return json(503, { ok: false, error: 'relay_not_configured', missing });
    if (!await tokenMatches(request.headers.get('x-auth-token'), env[route.tokenBinding])) {
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
    if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.embeds) || body.embeds.length === 0) {
      return json(400, { ok: false, error: 'embeds_required' });
    }

    const message = { ...body, allowed_mentions: { parse: [] } };
    delete message.channel_id;
    const channelId = channelFor(env, route);
    const sent = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        ...JSON_HEADERS,
        authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        'user-agent': 'Discord-Release-Proxy (+https://github.com/103PU/Valorant-Alert-Source)'
      },
      body: JSON.stringify(message)
    });

    const text = await sent.text();
    if (!sent.ok) {
      return json(sent.status === 429 ? 429 : 502, {
        ok: false,
        error: 'discord_rejected',
        status: sent.status,
        discord: text.slice(0, 1000)
      });
    }

    const shouldPrune = route.prunePrevious === true ||
      request.headers.get('x-discord-prune') === 'true';

    let sentMessage = {};
    try { sentMessage = JSON.parse(text); } catch { /* ignore parse error */ }
    const messageId = sentMessage.id ?? null;
    let botId = sentMessage.author?.id ?? null;

    if (shouldPrune && !botId && env.DISCORD_BOT_TOKEN) {
      try {
        const meResp = await fetch(`${DISCORD_API}/users/@me`, {
          headers: { authorization: `Bot ${env.DISCORD_BOT_TOKEN}` }
        });
        if (meResp.ok) {
          const me = await meResp.json();
          botId = me.id ?? null;
        }
      } catch {}
    }

    let crossposted = false;
    if (route.crosspost === true && messageId) {
      const published = await fetch(`${DISCORD_API}/channels/${channelId}/messages/${messageId}/crosspost`, {
        method: 'POST',
        headers: {
          ...JSON_HEADERS,
          authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
          'user-agent': 'Discord-Release-Proxy (+https://github.com/103PU/Valorant-Alert-Source)'
        }
      });
      if (!published.ok) {
        let pruned = null;
        if (shouldPrune && botId && messageId) {
          const result = await prunePreviousMessages(env, channelId, botId, messageId);
          pruned = result.pruned;
        }
        return json(200, {
          ok: true,
          messageId,
          channelId,
          crossposted: false,
          crosspostStatus: published.status,
          ...(pruned !== null ? { pruned } : {})
        });
      }
      crossposted = true;
    }

    let pruned = null;
    if (shouldPrune && botId && messageId) {
      const result = await prunePreviousMessages(env, channelId, botId, messageId);
      pruned = result.pruned;
    }

    return json(200, {
      ok: true,
      messageId,
      channelId,
      ...(route.crosspost === true ? { crossposted } : {}),
      ...(pruned !== null ? { pruned } : {})
    });
  }
};
