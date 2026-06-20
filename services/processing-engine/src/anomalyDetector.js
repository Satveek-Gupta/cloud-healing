'use strict';

/**
 * anomalyDetector.js
 * Evaluates telemetry data against a rule set and returns an array of
 * incident objects (empty array when everything is healthy).
 */

// ── Detection rules ────────────────────────────────────────────────────────
const RULES = [
  {
    type: 'high_cpu',
    severity: 'warning',
    check: d => d.cpu > 85 && d.cpu <= 95,
    summary: d => `High CPU usage: ${d.cpu.toFixed(1)}%`,
  },
  {
    type: 'critical_cpu',
    severity: 'critical',
    check: d => d.cpu > 95,
    summary: d => `Critical CPU usage: ${d.cpu.toFixed(1)}%`,
  },
  {
    type: 'high_memory',
    severity: 'warning',
    check: d => d.memory > 80 && d.memory <= 90,
    summary: d => `High memory usage: ${d.memory.toFixed(1)}%`,
  },
  {
    type: 'critical_memory',
    severity: 'critical',
    check: d => d.memory > 90,
    summary: d => `Critical memory usage: ${d.memory.toFixed(1)}%`,
  },
  {
    type: 'disk_warning',
    severity: 'warning',
    check: d => d.disk > 80 && d.disk <= 90,
    summary: d => `Disk usage warning: ${d.disk.toFixed(1)}%`,
  },
  {
    type: 'disk_critical',
    severity: 'critical',
    check: d => d.disk > 90,
    summary: d => `Critical disk usage: ${d.disk.toFixed(1)}%`,
  },
  {
    type: 'process_crash',
    severity: 'critical',
    check: d => d.process_crashed > 0,
    summary: d => `${d.process_crashed} crashed process(es) detected`,
  },
  {
    type: 'log_critical',
    severity: 'critical',
    check: d => d.log_severity === 'CRITICAL',
    summary: d => `Critical log detected: ${(d.log_summary || '').slice(0, 100)}`,
  },
  {
    type: 'log_error',
    severity: 'warning',
    check: d => d.log_severity === 'ERROR',
    summary: d => `Error log detected: ${(d.log_summary || '').slice(0, 100)}`,
  },
  {
    type: 'low_health_score',
    severity: 'critical',
    check: d => d.health_score < 40,
    summary: d => `Low health score: ${d.health_score}/100`,
  },
];

/**
 * Evaluate all rules against a normalized telemetry event.
 *
 * @param {Object} data - Normalized event from normalizer.normalize()
 * @returns {Array<Object>} Array of incident objects; empty when no anomalies found.
 */
function detectAnomalies(data) {
  const incidents = [];
  const now = Date.now();

  for (const rule of RULES) {
    let triggered = false;
    try {
      triggered = rule.check(data);
    } catch (err) {
      // A misbehaving rule should never crash the pipeline.
      console.error(`[anomalyDetector] Rule "${rule.type}" check threw: ${err.message}`);
      continue;
    }

    if (triggered) {
      incidents.push({
        incident_id: `${data.agent_id}-${rule.type}-${now}`,
        agent_id:    data.agent_id,
        severity:    rule.severity,
        type:        rule.type,
        summary:     rule.summary(data),
        status:      'investigating',
        created_at:  new Date(now).toISOString(),
      });
    }
  }

  return incidents;
}

module.exports = { detectAnomalies };
