const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard.html'), 'utf8');

test('dashboard update UI consumes progress, speed, cancel, and forced-update state', () => {
  for (const token of [
    'app-version', 'update/start', 'update/state', 'update/cancel',
    'speedBps', 'canCancel', 'forceUpdateRequired', 'stage === \'cancelled\''
  ]) assert.ok(html.includes(token), `dashboard missing ${token}`);
});
