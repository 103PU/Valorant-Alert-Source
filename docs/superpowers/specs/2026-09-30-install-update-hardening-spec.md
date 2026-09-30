# Valorant Alert Install and Update Hardening Specification

## Goal

Adopt the strongest applicable parts of `ValorantTweaks.App` packaging and update
workflow for `Valorant-Alert-Source`: ship one primary per-user Setup `.exe`, keep
the existing installer ZIP as a compatibility fallback, make update replacement
recoverable, and expose trustworthy progress without weakening the license gate.

## Scope

In scope:

- Windows x64 portable payload and Inno Setup single-file installer.
- In-app update discovery, download, verification, install handoff, cancellation,
  progress, and relaunch.
- Release artifact naming, checksum generation, validation, and tests.
- Authenticode/signature readiness and fail-closed verification for secure builds.
- Installer/update runtime proof on Windows.

Out of scope:

- Riot score polling, licensing policy, Google OAuth, cloud relay, or UI redesign.
- Changes to `ValorantTweaks.App`.
- Git tag push, GitHub Release creation, KLD production mutation, or secret changes.
- Replacing the Node/caxa runtime with .NET or PyInstaller.

## Existing Evidence

- `server/updater/index.js` already has server-side version selection, bounded
  downloads, streaming SHA-256, checksum fail-closed behavior, archive validation,
  retryable error stages, and route-level LAN/loopback guards.
- `tools/installer/Install-ValorantAlert.ps1` already stages and validates the
  payload before replacement, preserves user data, retries locked-file removal, and
  supports `-Launch`.
- `scripts/build.js` already creates portable and installer ZIPs plus
  `SHA256SUMS.txt` and `scripts/verify-release-artifacts.js` rechecks the bytes.
- `ValorantTweaks.App` adds the missing product-level pattern: a compiled Inno Setup
  `.exe`, an explicit update handoff, rollback-capable updater process, and secure
  release signing gates.

## Target Architecture

```text
package.json version
        |
        v
build.js -> caxa portable payload -> Inno Setup -> Setup.exe
        |                         \-> legacy installer ZIP
        \-> SHA256SUMS.txt + artifact verifier

KLD app-version decision
        |
        v
dashboard -> POST update/start
        |
        v
UpdateInstaller: download -> hash -> verify -> extract/prepare -> handoff
        |                                  |
        |                                  +-> Setup.exe /SILENT /CLOSEAPPLICATIONS
        |                                      or legacy Install-ValorantAlert.cmd
        v
detached installer/updater waits for old process, swaps staged tree, verifies,
rolls back on failure, launches the new app exactly once
```

## Contracts

### Release artifacts

- Primary user download: `ValorantScoreAlert-Setup-vX.Y.Z-win-x64.exe`.
- Compatibility downloads remain:
  - `ValorantScoreAlert-vX.Y.Z-win-x64.zip`.
  - `ValorantScoreAlert-vX.Y.Z-win-x64-installer.zip`.
- `SHA256SUMS.txt` contains exact SHA-256 lines for every published archive/setup.
- `package.json` remains the only version source.
- Build fails if any required artifact is missing, too small, misnamed, or has a
  checksum mismatch.

### Update selection

- Version and minimum-version decisions remain server-owned by KLD.
- GitHub fallback may notify, but cannot force-lock the app.
- Update URLs are derived from trusted release metadata and code-owned repository
  constants; request bodies never choose a version or URL.
- Prefer the Setup `.exe` when present; fallback to the verified installer ZIP for
  older releases.
- Missing or malformed checksum data is a hard failure before execution.

### Handoff and replacement

- Download to `%APPDATA%\\ValorantAlert\\update` using a temporary file.
- Never write into the live install tree from the Node server.
- Verify the staged payload before stopping/removing the current installation.
- Replacement must retain a recoverable previous tree until the new tree passes
  required-file and launch checks.
- Relaunch exactly once. Silent Inno `[Run]` must not duplicate the updater relaunch.
- Failed replacement restores the previous tree and reports a structured error.

### Trust

- Secure release builds sign the main executable, updater/installer executables,
  and Setup `.exe` when certificates are available.
- Secure release mode fails when signing configuration is absent or signing fails.
- The runtime verifier rejects a present-but-invalid signature before execution.
- Non-secure local builds may skip signing explicitly and are never release candidates.

### UX/API

- `update/state` exposes stage, version, bytes received/total, percent, speed,
  cancellable state, and structured error.
- `update/cancel` is loopback + share-token protected and only cancels download or
  verification; it cannot interrupt replacement after handoff.
- Dashboard shows progress, speed, cancel, retry, and release-page fallback.
- Forced updates cannot be dismissed; optional updates can be deferred.

## Acceptance Criteria

1. `npm test` passes with new artifact, updater, installer, and route coverage.
2. `node scripts/verify-release-artifacts.js` rejects stale/missing/mismatched
   Setup, ZIP, and checksum artifacts.
3. `npm run build` emits the Setup EXE, both ZIP compatibility artifacts, and sums.
4. Setup installs into `%LOCALAPPDATA%\\Programs\\ValorantAlert`, creates the
   expected shortcuts, preserves `%APPDATA%\\ValorantAlert`, and launches once.
5. Re-running Setup over a running install stops the old process, replaces the full
   tree, and starts exactly one new process.
6. A staged copy failure leaves the old installation intact.
7. A replacement failure restores the old installation and records a rollback log.
8. Download cancellation removes temporary artifacts and never spawns an installer.
9. Checksum missing, mismatch, oversized, truncated, and malformed release cases
   never execute a file.
10. Update route rejects GET, LAN start, wrong token, caller-selected version, and
    caller-selected URL.
11. Secure release signing and signature verification pass with a test certificate;
    missing/invalid signatures fail closed in secure mode.
12. A clean Windows smoke test proves old PID exits, new PID appears once, and
    `ValorantScoreAlert.exe` remains alive after handoff.

## Deliberate Simplifications

- No new long-running updater service. The detached installer/updater handoff is
  sufficient for this app and avoids another installation surface.
- No delta updates. Release packages are small enough that full verified artifacts
  are lower risk.
- No production signing key or release secret is added by this change.
