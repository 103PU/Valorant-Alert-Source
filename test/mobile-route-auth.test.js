const test = require('node:test');
const assert = require('node:assert/strict');
const { handleApiInfo } = require('../server/routes/api-info');
const { handleApiQr } = require('../server/routes/api-qr');

function response() {
  return {
    status: 0,
    body: '',
    writeHead(status) { this.status = status; },
    end(body = '') { this.body = body; }
  };
}

const dependencies = {
  wsServer: { getToken: () => 'ABC123', getConnectedDevices: () => [] },
  lanIp: '192.168.1.2', port: 3000,
  licensing: { cfg: { appDataDir: undefined }, getEntitledServices: () => [] }
};

test('LAN callers cannot obtain the share token without already knowing it', async () => {
  for (const route of [handleApiInfo, handleApiQr]) {
    const denied = response();
    await route({ url: '/api/info', socket: { remoteAddress: '192.168.1.3' }, headers: {} }, denied, dependencies);
    assert.equal(denied.status, 401);
    assert.doesNotMatch(denied.body, /ABC123/);
  }
  const local = response();
  handleApiInfo({ url: '/api/info', socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'localhost:3000' } }, local, dependencies);
  assert.equal(local.status, 200);
  assert.equal(JSON.parse(local.body).token, 'ABC123');
  const known = response();
  handleApiInfo({ url: '/api/info?token=ABC123', socket: { remoteAddress: '192.168.1.3' }, headers: { host: '192.168.1.2:3000' } }, known, dependencies);
  assert.equal(known.status, 200);
  const proxied = response();
  handleApiInfo({ url: '/api/info', socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'public.example' } }, proxied, dependencies);
  assert.equal(proxied.status, 401);
});
