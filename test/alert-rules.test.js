const test = require('node:test');
const assert = require('node:assert');
const { evaluateAlertStatus } = require('../server/core/alert-rules');

test('evaluateAlertStatus - In Match regular conditions', () => {
  assert.strictEqual(evaluateAlertStatus(0, 0), 'IN_MATCH');
  assert.strictEqual(evaluateAlertStatus(5, 3), 'IN_MATCH');
  assert.strictEqual(evaluateAlertStatus(10, 10), 'IN_MATCH');
  assert.strictEqual(evaluateAlertStatus(11, 11), 'IN_MATCH');
  assert.strictEqual(evaluateAlertStatus(12, 10), 'IN_MATCH'); // Allied team leading at 12
});

test('evaluateAlertStatus - Match Point Risk (Enemy at 12+ and leading)', () => {
  assert.strictEqual(evaluateAlertStatus(10, 12), 'MATCH_POINT_RISK');
  assert.strictEqual(evaluateAlertStatus(11, 12), 'MATCH_POINT_RISK');
  assert.strictEqual(evaluateAlertStatus(12, 13), 'MATCH_POINT_RISK'); // Overtime match point
});

test('evaluateAlertStatus - Match Victory / Defeat finished states', () => {
  assert.strictEqual(evaluateAlertStatus(13, 11), 'MATCH_VICTORY');
  assert.strictEqual(evaluateAlertStatus(13, 5), 'MATCH_VICTORY');
  assert.strictEqual(evaluateAlertStatus(14, 12), 'MATCH_VICTORY');
  assert.strictEqual(evaluateAlertStatus(11, 13), 'MATCH_DEFEAT');
  assert.strictEqual(evaluateAlertStatus(5, 13), 'MATCH_DEFEAT');
  assert.strictEqual(evaluateAlertStatus(12, 14), 'MATCH_DEFEAT');
});

test('evaluateAlertStatus - Custom Threshold Support', () => {
  // If user configures threshold = 10
  assert.strictEqual(evaluateAlertStatus(8, 10, 10), 'MATCH_POINT_RISK');
  assert.strictEqual(evaluateAlertStatus(8, 9, 10), 'IN_MATCH');
});
