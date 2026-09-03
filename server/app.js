const { handleApiQr } = require('./routes/api-qr');
const { handleApiInfo } = require('./routes/api-info');
const { handleApiShortcut } = require('./routes/api-shortcut');
const { handleApiLicense } = require('./routes/api-license');
const { handleStaticFiles } = require('./routes/static-files');

function createApp({ wsServer, lanIp, port, rootDir, publicDir, licensing }) {
  return async function requestHandler(req, res) {
    const reqPath = req.url.split('?')[0];

    // API Endpoint: Serve QR Code
    if (reqPath === '/api/qr') {
      return handleApiQr(req, res, { wsServer, lanIp, port });
    }

    // API Endpoint: Serve System Info
    if (reqPath === '/api/info') {
      return handleApiInfo(req, res, { wsServer, lanIp, port });
    }

    // API Endpoint: Create Desktop Shortcut
    if (reqPath === '/api/create-shortcut') {
      return handleApiShortcut(req, res, { rootDir });
    }

    // API Endpoints: Keylicense login / license status
    if (reqPath === '/api/license' || reqPath.startsWith('/api/license/')) {
      return handleApiLicense(req, res, { licensing, wsServer });
    }

    // Static Frontend Assets
    return handleStaticFiles(req, res, { publicDir });
  };
}

module.exports = { createApp };
