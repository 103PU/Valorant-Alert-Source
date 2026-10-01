# Shared Discord release proxy

One Cloudflare Worker, `discord-proxy`, and one bot send release notices from multiple app repos to fixed, separate channels. This source owns the deployed Worker. It supports Discord link buttons, which webhooks do not render.

## Routes

The `DISCORD_ROUTES` registry in `wrangler.jsonc` maps a route key to its channel and token binding. Callers may choose only a route key through `X-Discord-Route`; a channel ID in the JSON payload is ignored.

| Route | Channel | Worker token binding | Crosspost |
|---|---|---|---|
| `valorant-tweaks` | Existing live `DISCORD_CHANNEL_ID` binding | Existing `AUTH_TOKEN` | Yes, preserves current behavior |
| `valorant-alert` | `1555280650096087150` | `ALERT_AUTH_TOKEN` | No |

The bot token remains the existing `DISCORD_BOT_TOKEN` Worker secret. The Worker forces `allowed_mentions` off and never deletes messages. A failed crosspost does not make an already delivered message retryable.

## Deploy the shared Worker

Run from this directory after the release manifest authorizes deployment:

```powershell
npx --yes wrangler@4 deploy --keep-vars
```

`--keep-vars` is required: it preserves the live ValorantTweaks `DISCORD_CHANNEL_ID` dashboard variable while Wrangler updates `DISCORD_ROUTES`. Existing secrets are additive and are not removed by deploy. Do not deploy without this flag.

Keep these Cloudflare secrets set:

- `DISCORD_BOT_TOKEN` — existing bot token.
- `AUTH_TOKEN` — existing ValorantTweaks route token.
- `ALERT_AUTH_TOKEN` — a newly generated token used only by Valorant Alert.

Create `ALERT_AUTH_TOKEN` using Wrangler's secure prompt:

```powershell
npx --yes wrangler@4 secret put ALERT_AUTH_TOKEN
```

Generate the value once with a password manager, keep it there, and enter the same value into the Cloudflare prompt and the Alert repo's GitHub secret `CLOUDFLARE_AUTH_TOKEN`. Cloudflare does not show secret values again. Do not put secret values in `wrangler.jsonc`, command arguments, logs, or chat. `/health` lists missing binding names and configured route keys only; it does not return secret values or channel IDs.

## Configure GitHub Actions

In **each app repository**, configure:

| Secret | Value |
|---|---|
| `CLOUDFLARE_WORKER_URL` | `https://discord-proxy.dungbd2005.workers.dev` |
| `CLOUDFLARE_AUTH_TOKEN` | That app's route token only |

ValorantTweaks keeps its existing token. Valorant Alert uses the value configured as Worker secret `ALERT_AUTH_TOKEN`. Each workflow sends its fixed route header; release workflows send automatically, while `Notify Discord` supports manual resend.

The Alert release notice's first button downloads the built Setup `.exe` from `103PU/Valorant-Alert-Release`. The Worker only delivers the message; it does not build or publish app releases.

## Add a future app

1. Add a route to `DISCORD_ROUTES` with a fixed `channelId` and new `tokenBinding`.
2. Add that token as a Worker secret and as `CLOUDFLARE_AUTH_TOKEN` in the new app repo.
3. Set `CLOUDFLARE_WORKER_URL` there to the same Worker URL.
4. Add `X-Discord-Route: <route-key>` to the release sender.
5. Deploy this config through its approved release manifest.

Release announcements then send automatically. No new Worker, bot, or Worker code branch is needed. A shared GitHub Action or self-service route API is intentionally deferred until onboarding several apps makes these few config steps repetitive.

## Safe smoke and errors

```powershell
Invoke-RestMethod https://discord-proxy.dungbd2005.workers.dev/health
```

The health response must report `ok: true`, `configured: true`, and both initial route keys. This does not post to Discord. To verify actual delivery, dispatch `Notify Discord` with a real published tag only under an approved manifest.

| Status / error | Meaning |
|---|---|
| 400 `discord_route_required` | Missing `X-Discord-Route` |
| 404 `unknown_route` | Route key is not in `DISCORD_ROUTES` |
| 401 `invalid_auth_token` | Token does not match the selected route |
| 503 `relay_not_configured` | A required Worker binding is missing |
| 429 | Discord rate limit; `retry_after` is returned |
| 502 `discord_rejected` | Discord rejected the message or bot permissions are missing |
