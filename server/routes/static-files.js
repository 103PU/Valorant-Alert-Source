const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

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

const COMPRESSIBLE_TYPES = new Set([
  'text/html; charset=utf-8',
  'application/javascript',
  'text/css',
  'application/json',
  'image/svg+xml',
  'application/manifest+json'
]);

// In-memory cache: filePath -> { mtimeMs, size, etag, contentType, data, gzip }
const fileCache = new Map();

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
  const isHtml = ext === '.html';

  fs.stat(filePath, (statErr, stats) => {
    if (statErr || stats.isDirectory()) {
      if (!statErr && stats.isDirectory()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
        return;
      }
      if (statErr.code === 'ENOENT' || statErr.code === 'EISDIR' || statErr.code === 'ENOTDIR') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('500 Internal Server Error');
      }
      return;
    }

    const etag = `W/"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`;
    const ifNoneMatch = req.headers['if-none-match'];

    if (ifNoneMatch && ifNoneMatch === etag) {
      res.writeHead(304, {
        'ETag': etag,
        'Cache-Control': isHtml ? 'no-cache, must-revalidate' : 'public, max-age=86400, stale-while-revalidate=3600'
      });
      res.end();
      return;
    }

    const cached = fileCache.get(filePath);
    if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
      serveCached(req, res, cached, isHtml);
      return;
    }

    fs.readFile(filePath, (readErr, data) => {
      if (readErr) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('500 Internal Server Error');
        return;
      }

      let gzip = null;
      if (COMPRESSIBLE_TYPES.has(contentType) && data.length > 256) {
        try {
          gzip = zlib.gzipSync(data, { level: 6 });
        } catch (e) {}
      }

      const entry = {
        mtimeMs: stats.mtimeMs,
        size: stats.size,
        etag,
        contentType,
        data,
        gzip
      };

      // ponytail: in-memory cache unbounded, fine for single desktop app with ~15 static files
      fileCache.set(filePath, entry);
      serveCached(req, res, entry, isHtml);
    });
  });
}

function serveCached(req, res, entry, isHtml) {
  const acceptEncoding = req.headers['accept-encoding'] || '';
  const canGzip = entry.gzip && acceptEncoding.includes('gzip');
  const payload = canGzip ? entry.gzip : entry.data;

  const headers = {
    'Content-Type': entry.contentType,
    'ETag': entry.etag,
    'Cache-Control': isHtml ? 'no-cache, must-revalidate' : 'public, max-age=86400, stale-while-revalidate=3600',
    'Vary': 'Accept-Encoding',
    'Content-Length': payload.length
  };

  if (canGzip) {
    headers['Content-Encoding'] = 'gzip';
  }

  res.writeHead(200, headers);
  res.end(payload);
}

module.exports = { handleStaticFiles };
