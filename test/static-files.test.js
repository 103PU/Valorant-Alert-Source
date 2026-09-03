const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { handleStaticFiles } = require('../server/routes/static-files');

// A real tree: publicDir plus a sibling holding a file that must stay
// unreachable, and a prefix-sibling that must not pass the boundary check.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'va-static-'));
const publicDir = path.join(tmpRoot, 'public');
const siblingDir = path.join(tmpRoot, 'public-assets');
fs.mkdirSync(publicDir);
fs.mkdirSync(siblingDir);
fs.mkdirSync(path.join(publicDir, 'sub'));
fs.writeFileSync(path.join(publicDir, 'index.html'), '<h1>ok</h1>', 'utf8');
fs.writeFileSync(path.join(publicDir, 'sub', 'nested.js'), 'const a=1;', 'utf8');
fs.writeFileSync(path.join(siblingDir, 'leak.txt'), 'SIBLING-SECRET', 'utf8');
fs.writeFileSync(path.join(tmpRoot, 'secret.txt'), 'PARENT-SECRET', 'utf8');

let server;
let base;

test.before(async () => {
  server = http.createServer((req, res) => handleStaticFiles(req, res, { publicDir }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// Raw socket, because fetch/undici normalizes ../ out of the path before it
// ever reaches the server — which would make every traversal test pass
// vacuously against a vulnerable server.
function rawGet(rawPath) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const net = require('net');
    const sock = net.connect(port, '127.0.0.1', () => {
      sock.write(`GET ${rawPath} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
    });
    let buf = '';
    sock.on('data', (c) => { buf += c.toString('utf8'); });
    sock.on('end', () => {
      const status = parseInt((buf.split('\r\n')[0] || '').split(' ')[1], 10);
      const body = buf.slice(buf.indexOf('\r\n\r\n') + 4);
      resolve({ status, body, raw: buf });
    });
    sock.on('error', reject);
  });
}

test('serves index.html at /', async () => {
  const r = await rawGet('/');
  assert.strictEqual(r.status, 200);
  assert.match(r.body, /<h1>ok<\/h1>/);
  assert.match(r.raw, /Content-Type: text\/html/);
});

test('serves a nested file with the right mime type', async () => {
  const r = await rawGet('/sub/nested.js');
  assert.strictEqual(r.status, 200);
  assert.match(r.raw, /Content-Type: application\/javascript/);
});

test('missing file is 404, not 500', async () => {
  const r = await rawGet('/nope.html');
  assert.strictEqual(r.status, 404);
});

test('requesting a directory is 404, not 500', async () => {
  const r = await rawGet('/sub');
  assert.strictEqual(r.status, 404);
});

// The actual regression guard. Each of these reached outside publicDir before
// the fix at server/routes/static-files.js.
const TRAVERSALS = [
  ['plain dot-dot', '/../secret.txt'],
  ['deep dot-dot', '/../../../../../../etc/passwd'],
  ['encoded dot-dot', '/%2e%2e%2fsecret.txt'],
  ['double-encoded slash', '/..%2fsecret.txt'],
  ['backslash dot-dot', '/..\\secret.txt'],
  ['mixed separators', '/sub/..\\..\\secret.txt'],
  ['prefix sibling escape', '/../public-assets/leak.txt'],
  ['encoded backslash', '/..%5csecret.txt']
];

for (const [label, target] of TRAVERSALS) {
  test(`traversal blocked: ${label}`, async () => {
    const r = await rawGet(target);
    assert.ok(
      r.status === 403 || r.status === 404,
      `${label} returned ${r.status}, expected 403 or 404`
    );
    assert.ok(!r.body.includes('PARENT-SECRET'), `${label} leaked the parent file`);
    assert.ok(!r.body.includes('SIBLING-SECRET'), `${label} leaked the sibling file`);
  });
}

test('NUL byte in path is rejected', async () => {
  const r = await rawGet('/index.html%00.png');
  assert.strictEqual(r.status, 400);
});

test('malformed percent-encoding is 400, not a crash', async () => {
  const r = await rawGet('/%zz');
  assert.strictEqual(r.status, 400);
});
