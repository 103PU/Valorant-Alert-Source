# Shared Discord Release Proxy

## Goal

Use the existing `discord-proxy.dungbd2005.workers.dev` Worker and existing Discord bot for release notices from ValorantTweaks and Valorant Alert, while routing each app to its own channel. Make future app onboarding configuration-driven.

## Current evidence

- Valorant Alert has a local relay Worker at `tools/discord-relay/worker.mjs`, configured under the separate name `valorant-alert-discord-relay`.
- ValorantTweaks release workflows already POST to `CLOUDFLARE_WORKER_URL` with `X-Auth-Token`; the repo has no Worker source.
- The deployed Worker source provided by the user selects one channel through `env.DISCORD_CHANNEL_ID` and deletes bot-authored messages before posting.
- Valorant Alert's intended channel is `1555280650096087150` in server `1209942532511764580`.
- The Alert release notice links its primary button directly to the built Setup `.exe`.

## Design

Keep one Worker named `discord-proxy`; deploy its maintained source from `tools/discord-relay/worker.mjs`. A request supplies a route key in `X-Discord-Route`, never a channel ID. A Worker-side route registry maps each fixed key to a channel ID and an environment secret binding. The Worker rejects unknown routes and checks a distinct route token before contacting Discord. The shared bot token remains a Worker secret.

Initial routes:

- `valorant-tweaks` → preserve the existing Tweaks channel and auth token.
- `valorant-alert` → channel `1555280650096087150`, separate route token.

The registry lives in Wrangler configuration as non-secret data. Channel IDs are not credentials. Route tokens and the bot token stay in Worker secrets; each GitHub repository gets the shared Worker URL and only its own route token. Workflows send their fixed route key with the request. Request bodies cannot choose a route or channel.

The Worker posts notices without deleting existing channel messages. This avoids removing unrelated messages authored by any bot. It continues to overwrite `allowed_mentions` to prevent untrusted mentions and returns the selected channel ID for smoke verification. The ValorantTweaks route retains its current auto-crosspost behavior; Valorant Alert does not crosspost by default because the target channel type has not been confirmed.

## Adding a future app

1. Add one route entry containing the app's fixed channel ID and secret binding name.
2. Add that route's token as a Worker secret and as a GitHub Actions secret in the app repo.
3. Set `CLOUDFLARE_WORKER_URL` in the app repo to the existing Worker URL.
4. Add the route key to the app's release workflow request header.
5. Deploy the updated Worker config through the approved release pipeline.

No new Worker, bot, or Worker code branch is needed. Route config stays small and auditable. A KV-backed self-service registry is deliberately out of scope; add it only if frequent onboarding makes a config deploy a real bottleneck.

## Scope

- Update Alert relay source/config/docs and release workflow for the shared route contract.
- Update ValorantTweaks notification workflow to identify its existing route.
- Keep the Setup `.exe` release button and matching installation guidance.
- Do not create a Worker or bot. Do not change unrelated release/build behavior.
- Do not commit, push, set remote secrets, deploy, or post to Discord without the exact release manifest.

## Verification

- Check unknown route, wrong route token, correct per-route auth, route isolation, and body attempts to redirect channel.
- Confirm `allowed_mentions` remains forced off and Discord errors remain visible to CI.
- Validate that no path deletes Discord messages.
- Review both repository diffs and deployment bindings before presenting a release manifest.

## Deployment preservation

Before deployment, verify the authenticated Cloudflare account and that the target script is the existing `discord-proxy`. Use Wrangler `--keep-vars` so the existing Tweaks `DISCORD_CHANNEL_ID` remains intact; Wrangler v4 help confirms secrets are not deleted by deployment. Preserve the current `AUTH_TOKEN` and bot secret without reading or printing their values. Stop if the account, script, existing bindings, or `--keep-vars` behavior cannot be confirmed.
