const QRCode = require('qrcode');

async function handleApiQr(req, res, { wsServer, cloudRelay, lanIp, port, publicUrl }) {
  const parsed = new URL(req.url, 'http://localhost');
  const qrType = parsed.searchParams.get('type');
  const token = wsServer.getToken();

  const cloudUrl = cloudRelay && cloudRelay.getRelayWebUrl ? cloudRelay.getRelayWebUrl() : null;
  const localUrl = `${publicUrl || `http://${lanIp}:${port}`}?token=${token}`;

  let appUrl = cloudUrl || localUrl;
  if (qrType === 'lan') {
    appUrl = localUrl;
  } else if (qrType === 'cloud' && cloudUrl) {
    appUrl = cloudUrl;
  }
  try {
    const pngBuffer = await QRCode.toBuffer(appUrl, { type: 'png', margin: 1, width: 280 });
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Content-Length': pngBuffer.length
    });
    res.end(pngBuffer);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('QR generation error: ' + err.message);
  }
}

module.exports = { handleApiQr };
