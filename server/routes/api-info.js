const { readLockfile } = require('../riot/lockfile-reader');
const { getRegionInfo } = require('../riot/riot-region');

function handleApiInfo(req, res, { wsServer, cloudRelay, lanIp, port, publicUrl, licensing }) {
  const token = wsServer.getToken();
  const lockfile = readLockfile();
  const regionInfo = getRegionInfo();
  const mobileBase = publicUrl || `http://${lanIp}:${port}`;
  const relayStatus = cloudRelay ? cloudRelay.getStatus() : null;
  const services = licensing && typeof licensing.getEntitledServices === 'function' ? licensing.getEntitledServices() : [];
  const plan = licensing && licensing.gate && typeof licensing.gate.getPlanName === 'function' ? licensing.gate.getPlanName() : null;

  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache, no-store, must-revalidate'
  });
  res.end(JSON.stringify({
    port,
    lanIp,
    token,
    publicUrl: publicUrl || null,
    lanUrl: `${mobileBase}?token=${token}`,
    lanMobileUrl: `${mobileBase}?token=${token}`,
    lanDashboardUrl: `http://${lanIp}:${port}/dashboard.html?token=${token}`,
    localUrl: `http://localhost:${port}?token=${token}`,
    dashboardUrl: `http://localhost:${port}/dashboard.html?token=${token}`,
    cloudRelay: relayStatus,
    services,
    plan,
    riotConnected: !!lockfile,
    region: regionInfo.region,
    shard: regionInfo.shard,
    clientVersion: regionInfo.clientVersion,
    appVersion: (licensing && licensing.cfg && licensing.cfg.appVersion) || '1.0.7'
  }));
}

module.exports = { handleApiInfo };
