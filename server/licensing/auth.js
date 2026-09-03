const crypto = require('crypto');
const http = require('http');
const { exec } = require('child_process');

const logger = require('../utils/logger');

// Desktop login = Google OAuth authorization-code flow with PKCE over a loopback
// listener, the pattern ValorantTweaks uses (AuthService.cs). Not the browser
// GIS id_token flow: that one needs a web origin, and a desktop client has none.
//
// The Google client *secret* stays on KLD. This app only ever holds the public
// client id, the one-time code, and the PKCE verifier, so nothing here is a
// credential that would matter if the .exe were unpacked.

function base64Url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function createPkcePair() {
  const verifier = base64Url(crypto.randomBytes(32));
  const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

// A normal browser tab, deliberately not the app's `--app=` frameless mode:
// Google refuses sign-in in an app-mode window, and the user needs the address
// bar to confirm they are really on accounts.google.com before typing a password.
function openInBrowser(targetUrl) {
  if (process.platform === 'win32') {
    // start "" "<url>" via cmd — handles the & in a query string correctly.
    exec(`cmd /c start "" "${targetUrl}"`, () => {});
  } else if (process.platform === 'darwin') {
    exec(`open "${targetUrl}"`, () => {});
  } else {
    exec(`xdg-open "${targetUrl}"`, () => {});
  }
}

function buildAuthorizeUrl({ clientId, redirectUri, challenge, state }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    prompt: 'select_account'
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

function resultPage(title, message, ok) {
  const accent = ok ? '#12d18e' : '#ff4655';
  return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1419;
       color:#ece8e1;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
  .card{max-width:26rem;padding:2.5rem;text-align:center}
  .dot{width:3rem;height:3rem;margin:0 auto 1.25rem;border-radius:50%;background:${accent}}
  h1{margin:0 0 .5rem;font-size:1.25rem;letter-spacing:.02em}
  p{margin:0;color:#8b978f;line-height:1.6}
</style></head>
<body><div class="card"><div class="dot"></div>
<h1>${title}</h1><p>${message}</p></div></body></html>`;
}

/**
 * Runs one full loopback login. Resolves with KLD's exchange response
 * ({ ok, jwt, user, ... }) or rejects with a readable Error.
 */
function loginWithGoogle({ cfg, kld }) {
  return new Promise((resolve, reject) => {
    const { verifier, challenge } = createPkcePair();
    const state = base64Url(crypto.randomBytes(16));
    const timeoutMs = cfg.oauthLoginTimeoutMins * 60 * 1000;

    let settled = false;
    let timer = null;
    const listener = http.createServer();

    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      // close() waits for the response to flush before the callback fires.
      try {
        listener.close(() => fn(arg));
      } catch (e) {
        fn(arg);
      }
    };

    listener.on('request', async (req, res) => {
      let parsed;
      try {
        parsed = new URL(req.url, `http://127.0.0.1:${cfg.loopbackPort}`);
      } catch (e) {
        res.writeHead(400).end();
        return;
      }

      // Tolerate the trailing slash either way; Google echoes back exactly what
      // was registered, but a stray manual hit should not 404 confusingly.
      const path = parsed.pathname.replace(/\/+$/, '');
      if (path !== '/oauth/callback') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }

      const err = parsed.searchParams.get('error');
      const code = parsed.searchParams.get('code');
      const returnedState = parsed.searchParams.get('state');

      const fail = (msg, httpBody) => {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(resultPage('Đăng nhập thất bại', httpBody || msg, false));
        finish(reject, new Error(msg));
      };

      if (err) return fail(`Google từ chối đăng nhập: ${err}`);
      if (!code) return fail('Google không trả về authorization code.');

      // CSRF guard: a callback that did not originate from this login attempt
      // must never be exchanged.
      if (returnedState !== state) {
        return fail('State không khớp — yêu cầu đăng nhập không hợp lệ.');
      }

      try {
        const data = await kld.exchangeGoogleCode({
          code,
          redirectUri: cfg.redirectUri,
          codeVerifier: verifier
        });

        if (!data || !data.ok || !data.jwt) {
          return fail('Keylicense Dashboard không cấp được phiên đăng nhập.');
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(resultPage(
          'Đăng nhập thành công',
          'Bạn có thể đóng tab này và quay lại Valorant Score Alert.',
          true
        ));
        finish(resolve, data);
      } catch (e) {
        // e.code carries KLD's reason when it answered and refused.
        fail(`Không đổi được mã đăng nhập: ${e.code || e.message}`);
      }
    });

    listener.on('error', (e) => {
      const msg = e.code === 'EADDRINUSE'
        ? `Cổng đăng nhập ${cfg.loopbackPort} đang bị chiếm. Đóng ứng dụng đang dùng cổng này rồi thử lại.`
        : `Không mở được cổng đăng nhập: ${e.message}`;
      finish(reject, new Error(msg));
    });

    // 127.0.0.1 only — never 0.0.0.0. The callback carries a one-time code and
    // must not be reachable from the LAN.
    listener.listen(cfg.loopbackPort, '127.0.0.1', async () => {
      try {
        // Prefer KLD's copy so rotating the client id server-side takes effect
        // without shipping a new build; fall back to config.json when KLD is
        // unreachable. A Google client id is public by design, not a secret.
        let clientId = null;
        try {
          const idRes = await kld.getGoogleClientId();
          clientId = idRes && idRes.clientId;
        } catch (e) {
          logger.warn(`Không lấy được client id từ KLD (${e.message}), dùng config.json.`);
        }
        if (!clientId) clientId = cfg.googleClientId || null;
        if (!clientId) throw new Error('Không có Google client id (cả KLD và config.json đều thiếu).');

        const authorizeUrl = buildAuthorizeUrl({
          clientId,
          redirectUri: cfg.redirectUri,
          challenge,
          state
        });

        logger.info('Đang mở trình duyệt để đăng nhập Google...');
        openInBrowser(authorizeUrl);

        timer = setTimeout(() => {
          finish(reject, new Error(`Hết thời gian đăng nhập (${cfg.oauthLoginTimeoutMins} phút).`));
        }, timeoutMs);
      } catch (e) {
        finish(reject, new Error(`Không bắt đầu được đăng nhập: ${e.message}`));
      }
    });
  });
}

module.exports = { loginWithGoogle, createPkcePair, buildAuthorizeUrl, openInBrowser };
