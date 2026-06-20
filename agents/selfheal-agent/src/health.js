'use strict';

/**
 * Compute an aggregate health score (0–100) from metrics, logs, and process data.
 *
 * @param {{ cpu: number, memory: number, disk: number }} metrics
 * @param {{ severity: 'INFO'|'WARNING'|'ERROR'|'CRITICAL' }} logs
 * @param {{ crashed: any[] }} processes
 * @returns {number} Health score clamped to [0, 100]
 */
function computeHealthScore(metrics, logs, processes) {
  let score = 100;

  // CPU penalty
  if      (metrics.cpu > 95) score -= 30;
  else if (metrics.cpu > 85) score -= 20;
  else if (metrics.cpu > 70) score -= 10;

  // Memory penalty
  if      (metrics.memory > 90) score -= 25;
  else if (metrics.memory > 80) score -= 15;
  else if (metrics.memory > 65) score -= 8;

  // Disk penalty
  if      (metrics.disk > 95) score -= 30;
  else if (metrics.disk > 90) score -= 20;
  else if (metrics.disk > 80) score -= 10;

  // Process crashes (cap at 30 points)
  score -= Math.min(processes.crashed.length * 15, 30);

  // Log severity
  if      (logs.severity === 'CRITICAL') score -= 25;
  else if (logs.severity === 'ERROR')    score -= 15;
  else if (logs.severity === 'WARNING')  score -= 5;

  // Clamp to [0, 100]
  return Math.max(0, Math.min(100, score));
}

module.exports = { computeHealthScore };
