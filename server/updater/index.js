const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { Readable } = require('stream');

const logger = require('../utils/logger');
const {
  installerZipName,
  checksumFileName,
  normalizeVersion
} = require('../../scripts/release-naming');

// In-app update install — the piece ValorantTweaks has as UpdateDownloadService and
// this app did not. Until now the banner could only send the user to a web page.
//
// Two deliberate differences from upstream.
//
// 1. The download is verified against SHA256SUMS.txt before anything executes.
//    ValorantTweaks does not ship checksums at all. Honest limit of the check: it
//    stops corruption and a MITM, NOT a compromised repo — whoever can replace the
//    zip can replace the sums file beside it. The Ed25519 va-2026-09 key signs KLD
//    entitlement envelopes, not releases, so it cannot close that gap.
//
// 2. No Updater.exe. Upstream unpacks one and hands over. Here the installer is
//    already that program: Install-ValorantAlert.ps1 stops the running instance
//    (:80-104), verifies the staged tree before deleting the old one, and -Launch
//    (:264-270) starts the new build as its final, non-blocking act. So this module
//    only downloads, verifies, extracts, and spawns it.
//
// Nothing here writes inside the live install directory. The work dir is under
// %APPDATA%\ValorantAlert, the install is under %LOCALAPPDATA%\Programs — separate
// trees, so a failed extraction can never leave the running app half-replaced.
// Replacing files in place is the installer's job, and it is the only process that
// is allowed to do it.

const STAGE = Object.freeze({
  IDLE: 'idle',
  DOWNLOADING: 'downloading',
  VERIFYING: 'verifying',
  EXTRACTING: 'extracting',
  LAUNCHING: 'launching',
  LAUNCHED: 'launched',
  ERROR: 'error'
});

// A run may only be started from a settled stage; anything else means one is live.
const SETTLED = new Set([STAGE.IDLE, STAGE.ERROR, STAGE.LAUNCHED]);

// Which failures are worth a second attempt. A dropped socket and a truncated file
// are the same class of accident, so download and verify are retryable. Extract and
// launch failing means something structural — disk, antivirus, no PowerShell — and
// retrying just reproduces it, so the UI offers the release page instead.
const RETRYABLE = new Set(['download', 'verify']);

// Stall timeout rather than a total one: a 40 MB zip on a slow line is fine, a
// socket that stops sending is not. Reset on every chunk received.
const STALL_TIMEOUT_MS = 60 * 1000;
const MAX_ZIP_BYTES = 512 * 1024 * 1024;
const USER_AGENT = 'ValorantAlert-UpdateInstall';
const INSTALLER_CMD = 'Install-ValorantAlert.cmd';
const WORK_DIR_NAME = 'update';

// latestVersion arrives from KLD or from GitHub's tag_name — remote data — and is
// about to become a URL path segment and a file name. Two reasons this is checked
// against the RAW value rather than the normalized one: normalizeVersion() only
// strips a leading "v", so "../.." would pass straight through it, and its `|| '0.0.0'`
// default silently turns an empty version into a real-looking one. Naming a file
// 0.0.0 is harmless; downloading and running v0.0.0 is not.
const VERSION_RE = /^v?\d{1,4}\.\d{1,4}\.\d{1,4}$/i;

class UpdateError extends Error {
  constructor(stage, code, message) {
    super(message);
    this.name = 'UpdateError';
    this.stage = stage;
    this.code = code;
    this.retryable = RETRYABLE.has(stage);
  }
}

const fail = (stage, code, message) => new UpdateError(stage, code, message);

/** `sha256sum` output: 64 hex, whitespace, optional binary-mode `*`, then a name. */
function findChecksum(text, fileName) {
  const target = String(fileName).toLowerCase();
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.trim().match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
    if (m && path.basename(m[2].trim()).toLowerCase() === target) return m[1].toLowerCase();
  }
  return null;
}

// Node's fetch gives a web ReadableStream; a test hands in a Node Readable. Both
// are accepted so the suite can drive the real loop without a network call.
function toNodeStream(body) {
  if (!body) throw fail('download', 'empty_response', 'Không nhận được dữ liệu từ GitHub.');
  return typeof body.getReader === 'function' ? Readable.fromWeb(body) : body;
}

class UpdateInstaller {
  /**
   * Every side effect is injected, so the suite can drive the whole state machine
   * with no network call, no PowerShell, and no installer run on this machine.
   */
  constructor({ cfg, fetchImpl, spawnImpl, workDir } = {}) {
    this.cfg = cfg || {};
    this.fetchImpl = fetchImpl || ((...args) => globalThis.fetch(...args));
    this.spawnImpl = spawnImpl || spawn;
    this.workDir = workDir
      || path.join(this.cfg.appDataDir || process.cwd(), WORK_DIR_NAME);
    this.reset();
  }

  reset() {
    this.state = {
      stage: STAGE.IDLE,
      version: null,
      percent: null,
      bytesReceived: 0,
      bytesTotal: 0,
      error: null,
      startedAt: null,
      finishedAt: null
    };
  }

  snapshot() {
    return { ...this.state, busy: !SETTLED.has(this.state.stage) };
  }

  /**
   * Begins a run and returns immediately — the install takes minutes and the
   * dashboard polls `update/state` for progress. The version is passed in by the
   * caller from the server's own update check, never from a request body: a
   * client-supplied version (or worse, a URL) would make this an arbitrary-download
   * primitive reachable from the LAN.
   */
  async start(version) {
    if (!SETTLED.has(this.state.stage)) {
      throw fail(this.state.stage, 'update_already_running', 'Đang cập nhật, vui lòng chờ.');
    }
    if (process.platform !== 'win32') {
      throw fail('launch', 'platform_unsupported', 'Bộ cài chỉ chạy được trên Windows.');
    }
    const raw = String(version == null ? '' : version).trim();
    if (!VERSION_RE.test(raw)) {
      throw fail('release_lookup', 'bad_version', `Phiên bản không hợp lệ: ${JSON.stringify(raw)}`);
    }
    const v = normalizeVersion(raw);

    this.state = {
      stage: STAGE.DOWNLOADING,
      version: v,
      percent: 0,
      bytesReceived: 0,
      bytesTotal: 0,
      error: null,
      startedAt: Date.now(),
      finishedAt: null
    };
    // Fire and forget: run() records its own failure in state, and an unhandled
    // rejection here would take the whole server down with it.
    this.run(v).catch(() => {});
    return this.snapshot();
  }

  async run(version) {
    const asset = installerZipName(version);
    try {
      const dir = this.prepareWorkDir();
      const zipPath = path.join(dir, asset);
      const base = `https://github.com/${this.cfg.releaseRepo}/releases/download/v${version}`;

      const digest = await this.download(`${base}/${asset}`, zipPath);

      this.mark(STAGE.VERIFYING);
      await this.verify(`${base}/${checksumFileName()}`, zipPath, digest, asset);

      this.mark(STAGE.EXTRACTING);
      const payloadDir = path.join(dir, 'payload');
      await this.extract(zipPath, payloadDir);

      this.mark(STAGE.LAUNCHING);
      this.launch(payloadDir);

      this.state = {
        ...this.state, stage: STAGE.LAUNCHED, percent: 100, finishedAt: Date.now()
      };
      logger.info(`[update] installer launched for v${version}`);
    } catch (e) {
      const err = e instanceof UpdateError
        ? e
        : fail('download', 'unexpected_failure', (e && e.message) || String(e));
      this.state = {
        ...this.state,
        stage: STAGE.ERROR,
        finishedAt: Date.now(),
        error: {
          stage: err.stage, code: err.code, message: err.message, retryable: err.retryable
        }
      };
      logger.error(`[update] ${err.stage} failed: ${err.code} — ${err.message}`);
    }
  }

  mark(stage) {
    this.state = { ...this.state, stage };
  }

  prepareWorkDir() {
    const dir = this.workDir;
    // Guard in front of a recursive delete. The path is derived, not supplied, but
    // a mis-set appDataDir would otherwise point this rm at the wrong tree — so
    // require the leaf to be the sandbox this module owns.
    if (path.basename(dir) !== WORK_DIR_NAME) {
      throw fail('extract', 'bad_work_dir', `Thư mục cập nhật không hợp lệ: ${dir}`);
    }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  async request(url, signal, stage) {
    let res;
    try {
      res = await this.fetchImpl(url, {
        signal,
        redirect: 'follow',
        headers: { 'user-agent': USER_AGENT }
      });
    } catch (e) {
      throw fail(stage, 'network_unreachable', `Không kết nối được GitHub: ${e && e.message}`);
    }
    if (!res || !res.ok) {
      const status = res ? res.status : 0;
      throw fail(stage, `github_http_${status}`, `GitHub trả về HTTP ${status}.`);
    }
    return res;
  }

  /** Streams to disk and hashes in the same pass — the bytes are read once. */
  async download(url, dest) {
    const controller = new AbortController();
    let timer = setTimeout(() => controller.abort(), STALL_TIMEOUT_MS);
    let res;
    try {
      res = await this.request(url, controller.signal, 'download');
    } catch (e) {
      clearTimeout(timer);
      throw e;
    }

    const total = Number(res.headers.get('content-length')) || 0;
    if (total > MAX_ZIP_BYTES) {
      clearTimeout(timer);
      throw fail('download', 'asset_too_large', `Bộ cài quá lớn: ${total} bytes.`);
    }
    // percent stays null with no content-length, and the UI shows an indeterminate
    // bar rather than a made-up number.
    this.state = { ...this.state, bytesTotal: total, percent: total ? 0 : null };

    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(dest);
    let received = 0;
    try {
      for await (const chunk of toNodeStream(res.body)) {
        clearTimeout(timer);
        timer = setTimeout(() => controller.abort(), STALL_TIMEOUT_MS);
        received += chunk.length;
        // Bound the write even when content-length lied or was absent.
        if (received > MAX_ZIP_BYTES) {
          throw fail('download', 'asset_too_large', 'Bộ cài vượt giới hạn cho phép.');
        }
        hash.update(chunk);
        if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
        this.state = {
          ...this.state,
          bytesReceived: received,
          // Capped at 99: 100 belongs to a finished install, not a finished download.
          percent: total ? Math.min(99, Math.floor((received / total) * 100)) : null
        };
      }
      await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())));
    } catch (e) {
      out.destroy();
      fs.rmSync(dest, { force: true });
      throw e instanceof UpdateError
        ? e
        : fail('download', 'download_interrupted', (e && e.message) || String(e));
    } finally {
      clearTimeout(timer);
    }
    return hash.digest('hex');
  }

  async verify(sumsUrl, zipPath, digest, assetName) {
    const res = await this.request(sumsUrl, undefined, 'verify');
    const expected = findChecksum(await res.text(), assetName);
    // A zip that failed verification is deleted, not kept: leaving it on disk is
    // leaving something for a later run — or a curious user — to execute.
    if (!expected) {
      fs.rmSync(zipPath, { force: true });
      throw fail('verify', 'checksum_missing',
        `${assetName} không có trong ${checksumFileName()}.`);
    }
    if (expected !== digest) {
      fs.rmSync(zipPath, { force: true });
      throw fail('verify', 'checksum_mismatch',
        'sha256 không khớp với bản phát hành. Bộ cài đã bị xoá.');
    }
  }

  async extract(zipPath, destDir) {
    // Paths travel as environment variables instead of being interpolated into
    // -Command. Same rule the workflows follow: a value pasted inside a command
    // string is a quoting bug waiting for the first path with a quote or a bracket
    // in it — and `Valorant-Alert [1]` is exactly the shape that already broke
    // Copy-Item once in the installer.
    await this.runProcess('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
      'Expand-Archive -LiteralPath $env:VA_UPDATE_ZIP -DestinationPath $env:VA_UPDATE_OUT -Force'
    ], {
      env: { ...process.env, VA_UPDATE_ZIP: zipPath, VA_UPDATE_OUT: destDir }
    });

    // Expand-Archive exits 0 on a zip whose contents are not what we expect, so the
    // launch target is checked here rather than discovered missing a stage later.
    if (!fs.existsSync(path.join(destDir, INSTALLER_CMD))) {
      throw fail('extract', 'installer_missing', `Không tìm thấy ${INSTALLER_CMD} sau khi giải nén.`);
    }
  }

  runProcess(file, args, opts) {
    return new Promise((resolve, reject) => {
      let child;
      try {
        child = this.spawnImpl(file, args, { stdio: 'ignore', windowsHide: true, ...opts });
      } catch (e) {
        return reject(fail('extract', 'spawn_failed', (e && e.message) || String(e)));
      }
      child.on('error', (e) => reject(fail('extract', 'spawn_failed', e && e.message)));
      child.on('exit', (code) => (code === 0
        ? resolve()
        : reject(fail('extract', `extract_exit_${code}`, `Giải nén thất bại (exit ${code}).`))));
    });
  }

  launch(payloadDir) {
    const cmd = path.join(payloadDir, INSTALLER_CMD);
    // spawn() on a .cmd is refused outright by Node ≥18.20 (the CVE-2024-27980 fix)
    // unless shell:true — and shell:true is precisely where quoting bugs live. Going
    // through cmd.exe /c passes the path as a real argv entry, so nothing re-parses it.
    //
    // detached, its own console, and no inherited stdio are the point rather than a
    // side effect. The installer prints progress and ends with `pause`; -Launch has
    // already restarted the app by then. We are the process it is about to kill, so
    // the child must not sit in our process group or hold our stdio — otherwise
    // stopping this server takes the installer down with it, mid-swap.
    let child;
    try {
      child = this.spawnImpl('cmd.exe', ['/c', cmd, '-Launch'], {
        cwd: payloadDir,
        detached: true,
        stdio: 'ignore',
        windowsHide: false
      });
    } catch (e) {
      throw fail('launch', 'spawn_failed', (e && e.message) || String(e));
    }
    if (child && typeof child.unref === 'function') child.unref();
  }
}

module.exports = { UpdateInstaller, UpdateError, STAGE, RETRYABLE, findChecksum };
