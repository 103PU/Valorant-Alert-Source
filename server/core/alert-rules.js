/**
 * Business logic for evaluating score alert conditions.
 */
function evaluateAlertStatus(alliedScore, enemyScore, alertThreshold = 11) {
  // Alert condition: Enemy score is at or above alert threshold and Allied team is trailing
  if (enemyScore >= alertThreshold && alliedScore < enemyScore) {
    return 'MATCH_POINT_RISK';
  }
  return 'IN_MATCH';
}

module.exports = { evaluateAlertStatus };
