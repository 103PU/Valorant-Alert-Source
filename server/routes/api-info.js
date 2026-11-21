const { readLockfile } = require('../riot/lockfile-reader');
const { getRegionInfo } = require('../riot/riot-region');
const { loadSettings } = require('./api-settings');

function handleApiInfo(req, res, { wsServer, cloudRelay, lanIp, port, publicUrl, licensing }) {
  const remoteAddress = req.socket && req.socket.remoteAddress;
  const host = (req.headers?.host || '').replace(/:\d+$/, '').toLowerCase();
  const isLoopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remoteAddress) && ['localhost', '127.0.0.1', '[::1]'].includes(host);
  if (!isLoopback && new URL(req.url, 'http://localhost').searchParams.get('token') !== wsServer.getToken()) {
    res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: false, error: 'invalid_token' }));
    return;
  }
  const token = wsServer.getToken();
  const lockfile = readLockfile();
  const regionInfo = getRegionInfo();
  const mobileBase = publicUrl || `http://${lanIp}:${port}`;
  const relayStatus = cloudRelay ? cloudRelay.getStatus() : null;
  const services = licensing && typeof licensing.getEntitledServices === 'function' ? licensing.getEntitledServices() : [];
  const plan = licensing && licensing.gate && typeof licensing.gate.getPlanName === 'function' ? licensing.gate.getPlanName() : null;
  const appDataDir = licensing && licensing.cfg && licensing.cfg.appDataDir;
  const settings = loadSettings(appDataDir);

  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache, no-store, must-revalidate'
  });
  res.end(JSON.stringify({
    port,
    lanIp,
    token,
    publicUrl: publicUrl || null,
    lanUrl: `${mobileBase}?token=${token}&mode=lan`,
    lanMobileUrl: `${mobileBase}?token=${token}&mode=lan`,
    lanDashboardUrl: `http://${lanIp}:${port}/dashboard.html?token=${token}`,
    localUrl: `http://localhost:${port}?token=${token}`,
    dashboardUrl: `http://localhost:${port}/dashboard.html?token=${token}`,
    cloudRelay: relayStatus,
    services,
    plan,
    settings,
    riotConnected: !!lockfile,
    region: regionInfo.region,
    shard: regionInfo.shard,
    clientVersion: regionInfo.clientVersion,
    devices: wsServer && typeof wsServer.getConnectedDevices === 'function' ? wsServer.getConnectedDevices() : [],
    appVersion: (licensing && licensing.cfg && licensing.cfg.appVersion) || '1.0.8'
  }));
}

module.exports = { handleApiInfo };
