/**
 * Business logic for evaluating score alert conditions.
 */
function evaluateAlertStatus(alliedScore, enemyScore, alertThreshold = 12) {
  // Check Match Finished
  if ((alliedScore >= 13 || enemyScore >= 13) && Math.abs(alliedScore - enemyScore) >= 2) {
    return alliedScore > enemyScore ? 'MATCH_VICTORY' : 'MATCH_DEFEAT';
  }

  // Exact Match Point condition (Enemy at 12 or above and leading)
  if (enemyScore >= alertThreshold && enemyScore > alliedScore) {
    return 'MATCH_POINT_RISK';
  }
  return 'IN_MATCH';
}

module.exports = { evaluateAlertStatus };
