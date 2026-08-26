const QRCode = require('qrcode');

async function handleApiQr(req, res, { wsServer, lanIp, port }) {
  const token = wsServer.getToken();
  const appUrl = `http://${lanIp}:${port}?token=${token}`;
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
