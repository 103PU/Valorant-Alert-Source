const fs = require('fs');
const path = require('path');

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

function handleStaticFiles(req, res, { publicDir }) {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/') reqPath = '/index.html';

  // Percent-decode before any check: without this, %2e%2e%2f walks straight
  // past a literal '..' test and out of publicDir.
  try {
    reqPath = decodeURIComponent(reqPath);
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('400 Bad Request');
    return;
  }

  // Backslash is a separator on Windows but not in a URL, so normalize it or
  // \..\ escapes on exactly the platform this app ships to.
  reqPath = reqPath.replace(/\\/g, '/');

  // NUL truncates the path at the syscall layer on some platforms; refuse it
  // rather than trying to reason about what the OS will see.
  if (reqPath.includes('\0')) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('400 Bad Request');
    return;
  }

  const publicRoot = path.resolve(publicDir);
  const filePath = path.resolve(publicRoot, '.' + path.posix.normalize(reqPath));

  // The real guard: whatever the request said, the resolved path must still be
  // inside publicDir. Compare against root + separator so a sibling directory
  // named like a prefix of it (public-assets vs public) cannot pass.
  if (filePath !== publicRoot && !filePath.startsWith(publicRoot + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // EISDIR/ENOTDIR are "no such file" from the client's point of view; only
      // a genuine read failure is a 500.
      if (err.code === 'ENOENT' || err.code === 'EISDIR' || err.code === 'ENOTDIR') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('500 Internal Server Error');
      }
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, must-revalidate'
    });
    res.end(data);
  });
}

module.exports = { handleStaticFiles };
