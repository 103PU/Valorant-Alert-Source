const { readLockfile } = require('../riot/lockfile-reader');
const { getRegionInfo } = require('../riot/riot-region');

function handleApiInfo(req, res, { wsServer, lanIp, port }) {
  const token = wsServer.getToken();
  const lockfile = readLockfile();
  const regionInfo = getRegionInfo();

  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache, no-store, must-revalidate'
  });
  res.end(JSON.stringify({
    port,
    lanIp,
    token,
    lanUrl: `http://${lanIp}:${port}?token=${token}`,
    lanMobileUrl: `http://${lanIp}:${port}?token=${token}`,
    lanDashboardUrl: `http://${lanIp}:${port}/dashboard.html?token=${token}`,
    localUrl: `http://localhost:${port}?token=${token}`,
    dashboardUrl: `http://localhost:${port}/dashboard.html?token=${token}`,
    riotConnected: !!lockfile,
    region: regionInfo.region,
    shard: regionInfo.shard,
    clientVersion: regionInfo.clientVersion
  }));
}

module.exports = { handleApiInfo };
