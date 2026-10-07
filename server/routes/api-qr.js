const QRCode = require('qrcode');

// In-memory cache for QR code PNG buffers: appUrl -> { buffer, etag }
const qrCache = new Map();

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

  // Fast-path: Return cached QR code immediately without re-rendering
  const cached = qrCache.get(appUrl);
  if (cached) {
    const ifNoneMatch = req.headers['if-none-match'];
    if (ifNoneMatch && ifNoneMatch === cached.etag) {
      res.writeHead(304, { 'ETag': cached.etag });
      res.end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'ETag': cached.etag,
      'Cache-Control': 'no-cache, must-revalidate',
      'Content-Length': cached.buffer.length
    });
    res.end(cached.buffer);
    return;
  }

  try {
    const pngBuffer = await QRCode.toBuffer(appUrl, { type: 'png', margin: 1, width: 280 });
    const etag = `W/"qr-${Buffer.from(appUrl).toString('base64url').slice(0, 16)}"`;
    // ponytail: clear cache when exceeding 20 items, only a few URLs ever exist
    if (qrCache.size > 20) qrCache.clear();
    qrCache.set(appUrl, { buffer: pngBuffer, etag });

    res.writeHead(200, {
      'Content-Type': 'image/png',
      'ETag': etag,
      'Cache-Control': 'no-cache, must-revalidate',
      'Content-Length': pngBuffer.length
    });
    res.end(pngBuffer);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('QR generation error: ' + err.message);
  }
}

module.exports = { handleApiQr };

