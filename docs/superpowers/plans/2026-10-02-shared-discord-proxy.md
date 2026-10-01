# Shared Discord Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` for inline execution. Steps use checkbox syntax for tracking.

**Goal:** Route ValorantTweaks and Valorant Alert release notices through the existing `discord-proxy` Worker and bot into separate channels.

**Architecture:** The Worker resolves a fixed `X-Discord-Route` against `DISCORD_ROUTES_JSON`. Each route binds to one channel and one route token; arbitrary request channel IDs are ignored. Workflows retain app-specific payload generation and add one route header. The Worker posts without deleting existing messages.

**Tech Stack:** Cloudflare Workers module JavaScript, Wrangler JSONC, GitHub Actions YAML, Node built-in test runner.

**Spec:** `docs/superpowers/specs/2026-10-02-shared-discord-proxy-design.md`

## Global Constraints

- Keep one Worker named `discord-proxy` and the existing Discord bot.
- Never accept a channel ID or auth binding name from the request body.
- Use a distinct route token per app; keep every token out of source and logs.
- Preserve the existing Tweaks channel binding and route token.
- Route Valorant Alert to `1555280650096087150`.
- Do not delete Discord messages.
- Keep the Setup `.exe` as the primary Alert download button.
- Do not commit, push, set secrets, deploy, or post until an exact release manifest is approved.
- Preserve unrelated dirty changes in `ValorantTweaks.App`.

---

### Task 1: Add safe route selection to the shared Worker

**Files:**
- Modify: `tools/discord-relay/worker.mjs`
- Modify: `test/discord-relay.test.js`

**Interfaces:**
- Request header: `X-Discord-Route` selects an allowlisted registry entry.
- Request header: `X-Auth-Token` authenticates against that route's configured secret binding.
- Worker config: `DISCORD_ROUTES_JSON` maps route keys to channel ID/channel binding and token binding.
- Existing `DISCORD_CHANNEL_ID` and `AUTH_TOKEN` remain supported for `valorant-tweaks` during migration.

- [ ] Add failing tests for both routes, route-specific auth, unknown routes, body channel hijack, message preservation, and mentions.
- [ ] Run focused tests and confirm failures.
- [ ] Implement route parsing, fail-closed validation, per-route token lookup, and channel resolution.
- [ ] Ensure sends never delete messages; retain configured auto-crosspost for ValorantTweaks only.
- [ ] Run focused tests and confirm pass.

### Task 2: Configure one Worker for both apps

**Files:**
- Modify: `tools/discord-relay/wrangler.jsonc`
- Modify: `tools/discord-relay/README.md`

**Interfaces:**
- Worker name is `discord-proxy`.
- `valorant-alert` uses channel `1555280650096087150` and secret binding `ALERT_AUTH_TOKEN`.
- `valorant-tweaks` retains the live `DISCORD_CHANNEL_ID` binding and existing `AUTH_TOKEN` binding.

- [ ] Add the route registry with no token values.
- [ ] Document initial secret bindings, health checks, and the future-app onboarding steps.
- [ ] Confirm migration/deploy preserves existing Worker vars and secrets; stop if Wrangler cannot preserve the live Tweaks channel binding safely.

### Task 3: Route every release sender

**Files:**
- Modify: `.github/workflows/release.yml`
- Modify: `.github/workflows/notify-discord.yml`
- Modify in `E:\PROJECT\ValorantTweaks.App`: `.github/workflows/release.yml`
- Modify in `E:\PROJECT\ValorantTweaks.App`: `.github/workflows/notify-discord-bot.yml`

- [ ] Add `X-Discord-Route: valorant-alert` to both Alert workflow requests.
- [ ] Add `X-Discord-Route: valorant-tweaks` to both Tweaks workflow requests.
- [ ] Keep each repo's `CLOUDFLARE_WORKER_URL` and `CLOUDFLARE_AUTH_TOKEN` secret references unchanged.

### Task 4: Keep Alert notice aligned with the published asset

**Files:**
- Modify: `scripts/discord-release-notice.js`
- Modify: `test/discord-notice.test.js`
- Modify: `docs/release-runbook.md`

- [ ] Keep the Setup `.exe` URL and installation instructions as the primary release path.
- [ ] Confirm the direct URL uses the release repo and asset naming function.
- [ ] Document the route and manual notify workflow.

### Task 5: Verify and prepare the release gate

- [ ] Run focused Worker and notice tests.
- [ ] Run YAML/JSONC syntax validation and `git diff --check` in both repos.
- [ ] Review both diffs and confirm the three pre-existing Tweaks UI files are untouched.
- [ ] Read current Wrangler deploy documentation and verify preservation/rollback commands.
- [ ] Present one exact manifest for commit/push, existing Worker deployment, secrets/variables, and optional Discord smoke; do not execute remote steps without approval.
