const { readLockfile } = require('../riot/lockfile-reader');
const { getRegionInfo } = require('../riot/riot-region');

function handleApiInfo(req, res, { wsServer, cloudRelay, lanIp, port, publicUrl }) {
  const token = wsServer.getToken();
  const lockfile = readLockfile();
  const regionInfo = getRegionInfo();
  const mobileBase = publicUrl || `http://${lanIp}:${port}`;
  const relayStatus = cloudRelay ? cloudRelay.getStatus() : null;

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
    riotConnected: !!lockfile,
    region: regionInfo.region,
    shard: regionInfo.shard,
    clientVersion: regionInfo.clientVersion
  }));
}

module.exports = { handleApiInfo };
