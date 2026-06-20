'use strict';

/**
 * normalizer.js
 * Applies domain-level normalization rules to a validated telemetry event.
 * Always returns a fresh object (does not mutate the input).
 */

const MAX_LOG_SUMMARY_LEN = 500;

/**
 * Clamp a numeric value to [min, max].
 * @param {number} val
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

/**
 * Round a number to `places` decimal places.
 * @param {number} val
 * @param {number} places
 * @returns {number}
 */
function round(val, places) {
  const factor = Math.pow(10, places);
  return Math.round(val * factor) / factor;
}

/**
 * Normalize a validated telemetry event.
 *
 * Rules applied:
 *  - timestamp → valid ISO 8601 string, fallback to now
 *  - cpu / memory / disk → clamped to [0, 100], rounded to 2 dp
 *  - health_score → integer clamped to [0, 100]
 *  - log_summary → truncated to 500 characters
 *
 * @param {Object} data - Output from validate().data
 * @returns {Object} Clean, normalized copy of the event
 */
function normalize(data) {
  // ── Timestamp ──────────────────────────────────────────────────────────────
  let timestamp = data.timestamp;
  if (!timestamp || isNaN(Date.parse(timestamp))) {
    timestamp = new Date().toISOString();
  } else {
    // Re-serialize to guarantee ISO 8601 format (handles Unix epoch strings too).
    timestamp = new Date(timestamp).toISOString();
  }

  // ── Percentage metrics ─────────────────────────────────────────────────────
  const cpu    = round(clamp(data.cpu,    0, 100), 2);
  const memory = round(clamp(data.memory, 0, 100), 2);
  const disk   = round(clamp(data.disk,   0, 100), 2);

  // ── Health score ───────────────────────────────────────────────────────────
  const health_score = clamp(Math.round(data.health_score), 0, 100);

  // ── Log summary ────────────────────────────────────────────────────────────
  let log_summary = data.log_summary || null;
  if (log_summary && log_summary.length > MAX_LOG_SUMMARY_LEN) {
    log_summary = log_summary.slice(0, MAX_LOG_SUMMARY_LEN);
  }

  // ── Integer metrics for Bigint/Int columns ─────────────────────────────────
  const network_in   = data.network_in != null ? Math.round(Number(data.network_in)) : 0;
  const network_out  = data.network_out != null ? Math.round(Number(data.network_out)) : 0;
  const uptime_seconds = data.uptime_seconds != null ? Math.round(Number(data.uptime_seconds)) : null;

  // ── Return a clean copy ────────────────────────────────────────────────────
  return {
    ...data,
    timestamp,
    cpu,
    memory,
    disk,
    health_score,
    log_summary,
    network_in,
    network_out,
    uptime_seconds,
  };
}

module.exports = { normalize };
