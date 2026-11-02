const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { handleApiSimulator } = require('../server/routes/api-simulator');

test('POST /api/simulator requires loopback or valid token and broadcasts score', async () => {
  let broadcastCalled = false;
  const mockWs = {
    getToken: () => 'VALID_PIN',
    getClientCount: () => 0,
    broadcastScore: (data) => {
      broadcastCalled = true;
      assert.equal(data.alliedScore, 5);
      assert.equal(data.enemyScore, 4);
    }
  };

  const server = http.createServer((req, res) => {
    handleApiSimulator(req, res, { wsServer: mockWs });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    // 1. GET is 405
    const getRes = await fetch(`http://127.0.0.1:${port}`);
    assert.equal(getRes.status, 405);

    // 2. POST with valid score data
    const postRes = await fetch(`http://127.0.0.1:${port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alliedScore: 5, enemyScore: 4, mapName: 'ASCENT' })
    });
    assert.equal(postRes.status, 200);
    const data = await postRes.json();
    assert.equal(data.ok, true);
    assert.equal(broadcastCalled, true);
  } finally {
    server.close();
  }
});
