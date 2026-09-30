# Valorant Alert Install and Update Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship a primary single-file Setup EXE and harden Valorant Alert's update handoff, replacement, trust checks, and progress UX using the proven `ValorantTweaks.App` pattern.

**Architecture:** Keep the existing Node/caxa payload and server-owned KLD update decision. Add Inno Setup as the primary installer, retain the current installer ZIP fallback, and move replacement into a detached, rollback-capable handoff so the live Node process never copies over itself.

**Tech Stack:** Node.js built-in test runner, caxa, PowerShell 5.1, Inno Setup 6, Windows Authenticode/signtool, existing HTML dashboard.

**Spec:** `docs/superpowers/specs/2026-09-30-install-update-hardening-spec.md`

## Global Constraints

- Modify only `E:\PROJECT\Valorant-Alert-Source`; do not modify `ValorantTweaks.App`.
- Preserve KLD license, OAuth, score polling, cloud relay, and existing API contracts.
- Keep `package.json` as the only version source.
- Never execute a downloaded artifact before checksum and payload validation.
- Never accept version, URL, install path, or executable path from an update request body.
- Do not add a runtime dependency when Node/PowerShell/Inno already provide the capability.
- Do not publish, tag, push, deploy, or change secrets.

---

### Task 1: Freeze current behavior and add the release contract tests

**Files:**
- Modify: `test/release-artifacts.test.js`
- Modify: `test/update-download.test.js`
- Modify: `test/update-routes.test.js`
- Create: `test/update-cancel.test.js`
- Create: `test/installer-contract.test.js`

**Interfaces:**
- Consumes existing `release-naming.js`, `UpdateInstaller`, and route helpers.
- Produces executable acceptance tests consumed by Tasks 2-7.

- [x] Step 1: Add failing tests for Setup EXE naming, checksum inclusion, legacy ZIP fallback, and exact resolver classification.
- [x] Step 2: Add failing tests for speed fields, cancellation cleanup, and no spawn after cancellation.
- [x] Step 3: Add failing tests for installer rollback marker/backup behavior and exactly-once relaunch contract.
- [x] Step 4: Add failing tests for secure-mode signature failure and invalid signature rejection using injected verifier doubles.
- [x] Step 5: Run `rtk npm test -- --test-name-pattern "Setup|cancel|rollback|signature"`; record expected failures.

### Task 2: Add the Inno Setup primary artifact

**Files:**
- Create: `tools/installer/ValorantAlert.iss`
- Modify: `scripts/release-naming.js`
- Modify: `scripts/build.js`
- Modify: `scripts/verify-release-artifacts.js`
- Modify: `test/release-artifacts.test.js`

**Interfaces:**
- `build.js` produces `setupExeName(version)` beside the two existing ZIPs.
- `ValorantAlert.iss` consumes `SourceDir`, `OutputDir`, `MyAppVersion`, and writes the per-user app under `%LOCALAPPDATA%\\Programs\\ValorantAlert`.
- The Setup `[Run]` entry uses `skipifsilent`; the detached handoff owns silent relaunch.

- [x] Step 1: Add `setupExeName(version)` and keep existing ZIP naming unchanged.
- [x] Step 2: Write Inno entries for app files, Start Menu/Desktop shortcuts via `scripts\\launcher.vbs`, uninstall, per-user install, and preserved `%APPDATA%\\ValorantAlert` data.
- [x] Step 3: Compile Setup from the already-built `ValorantScoreAlert-Release` tree; do not rebuild or produce a second payload.
- [x] Step 4: Add Setup EXE checksum generation and exact artifact validation.
- [x] Step 5: Run `rtk npm test -- --test-name-pattern "release artifact|installer"`.
- [x] Step 6: Run `rtk npm run build` on a Windows host with `ISCC.exe`; verify all four output files and `SHA256SUMS.txt`.

### Task 3: Replace direct script handoff with a safe dual-mode updater handoff

**Files:**
- Modify: `server/updater/index.js`
- Modify: `server/licensing/index.js`
- Modify: `server/routes/api-license.js`
- Modify: `test/update-download.test.js`
- Modify: `test/update-routes.test.js`
- Create: `test/update-handoff.test.js`

**Interfaces:**
- `UpdateInstaller.start(version, options)` remains the route-facing entry point.
- `UpdateInstaller.cancel()` returns a state snapshot and only applies before launch.
- `UpdateInstaller.snapshot()` adds `speedBps`, `canCancel`, and `handoffKind`.

- [x] Step 1: Make release lookup prefer a Setup EXE URL when the release metadata exposes it, with installer ZIP fallback for old releases.
- [x] Step 2: Keep streaming hash and add measured bytes-per-second without changing the existing percent semantics.
- [x] Step 3: Add an `AbortController` owned by the run and implement idempotent cancellation that removes `.part`/ZIP files.
- [x] Step 4: Launch Setup with `cmd.exe /c start /wait` and `/SILENT /SP- /CLOSEAPPLICATIONS /SUPPRESSMSGBOXES`; use the legacy `.cmd -Launch` path only when no Setup EXE exists.
- [x] Step 5: Keep the server detached from the child and never wait for a process that will stop the server.
- [x] Step 6: Add `POST /api/license/update/cancel` with the same loopback + token guard as update start.
- [x] Step 7: Run `rtk npm test -- --test-name-pattern "update|checksum|cancel|handoff"`.

### Task 4: Make installer replacement recoverable

**Files:**
- Modify: `tools/installer/Install-ValorantAlert.ps1`
- Modify: `tools/installer/README-FIRST.txt`
- Modify: `test/installer-contract.test.js`

**Interfaces:**
- Installer owns a sibling backup directory under `%LOCALAPPDATA%\\Programs`.
- On successful required-file validation and launch handoff, backup cleanup is allowed.
- On move/verification failure, the previous install is restored before returning failure.

- [x] Step 1: Add a unique sibling backup path and rename the current install into it only after the staged tree passes validation.
- [x] Step 2: Move staged tree into the install path and verify `ValorantScoreAlert.exe` plus `scripts\\launcher.vbs`.
- [x] Step 3: Restore the backup when replacement or post-move validation fails.
- [x] Step 4: Keep backup cleanup after success only; never delete user data under `%APPDATA%\\ValorantAlert`.
- [x] Step 5: Add an install lock/marker so concurrent Setup launches refuse cleanly.
- [x] Step 6: Run PowerShell parser/static checks and `rtk npm test -- --test-name-pattern "installer"`.

### Task 5: Add secure release signing and runtime signature verification

**Files:**
- Modify: `scripts/build.js`
- Modify: `scripts/verify-release-artifacts.js`
- Modify: `server/updater/index.js`
- Create: `scripts/verify-authenticode.ps1`
- Modify: `test/update-handoff.test.js`
- Modify: `docs/release-runbook.md`

**Interfaces:**
- Secure build mode is enabled only by `SECURE_RELEASE=1` or an explicit build flag.
- `verify-authenticode.ps1 -Path dist\\ValorantScoreAlert.exe -RequireValid` exits non-zero for missing/invalid signatures.
- Runtime verification is injected in tests and runs before Setup/legacy installer spawn.

- [x] Step 1: Add a fail-closed secure-build guard for missing signing tool/certificate; leave non-secure local builds explicitly unsigned.
- [x] Step 2: Sign the main caxa EXE and Setup EXE when secure mode is enabled; avoid logging certificate paths/passwords.
- [x] Step 3: Verify signatures in the release artifact gate and runtime handoff before execution.
- [x] Step 4: Add negative tests for missing, invalid, and wrong-subject signatures.
- [x] Step 5: Run `rtk npm test -- --test-name-pattern "signature|secure release"` and PowerShell verifier checks.

### Task 6: Dashboard update progress and cancellation

**Files:**
- Modify: `public/dashboard.html`
- Modify: `test/update-routes.test.js`
- Modify: `test/app-version.test.js`

**Interfaces:**
- Dashboard consumes only `/api/license/app-version`, `/api/license/update/start`,
  `/api/license/update/state`, and `/api/license/update/cancel`.
- UI renders server stage/error decisions; it does not compare versions or construct URLs.

- [x] Step 1: Render bytes, speed, stage, retry, cancel, and release-page fallback from state.
- [x] Step 2: Disable cancel after `launching`; prevent duplicate start/cancel requests.
- [x] Step 3: Preserve non-dismissible behavior for `forceUpdateRequired`.
- [x] Step 4: Add static contract tests for every route/action and forced-update behavior.
- [x] Step 5: Run `rtk npm test -- --test-name-pattern "dashboard|update"`.

### Task 7: Windows package and runtime verification

**Files:**
- Modify: `docs/release-runbook.md`
- Modify: `docs/pending-and-blocked.md`
- Modify: `docs/system-state.md`

**Interfaces:**
- No production mutation. Evidence is local build/package/runtime evidence only.

- [x] Step 1: Run full `rtk npm test`.
- [x] Step 2: Run `rtk npm run build` and `rtk node scripts/verify-release-artifacts.js` with Inno Setup available.
- [ ] Step 3: Install the Setup EXE into a clean per-user path; verify shortcuts, app startup, and user-data preservation. (Pending clean VM/machine.)
- [ ] Step 4: Start the installed app, trigger a verified update, record old PID exit and exactly one new PID. (Pending clean VM/machine.)
- [x] Step 5: Inject staged-copy and move failures; verify rollback leaves the previous app launchable. (Contract/static coverage; live injection pending.)
- [x] Step 6: Run cross-review: untouched criteria, first abuse attempt, out-of-scope changes, docs sync.
- [x] Step 7: Restore generated `dist/`, logs, `obj/`, and integrity artifacts; report PASS/PARTIAL/BLOCKER per criterion.

## Verification Commands

```powershell
rtk npm test
rtk npm run build
rtk node scripts/verify-release-artifacts.js
rtk proxy powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-authenticode.ps1 -Path dist\\ValorantScoreAlert.exe -RequireValid
```

No tag, push, publish, deploy, or secret mutation is part of this plan.
