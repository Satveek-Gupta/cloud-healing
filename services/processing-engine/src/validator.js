'use strict';

/**
 * validator.js
 * Validates and lightly parses a raw Redis stream event (all values are strings).
 * Returns { valid, data, error }.
 */

const REQUIRED_FIELDS = ['agent_id', 'cpu', 'memory', 'disk', 'health_score', 'timestamp'];

/**
 * Safely parse a float from a string.  Returns NaN if the value is absent or
 * not a valid number.
 * @param {string|undefined} val
 * @returns {number}
 */
function parseFloat_(val) {
  if (val === undefined || val === null || val === '') return NaN;
  const n = Number(val);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Safely parse an integer from a string.
 * @param {string|undefined} val
 * @returns {number}
 */
function parseInt_(val) {
  if (val === undefined || val === null || val === '') return NaN;
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Validate a raw Redis stream event object.
 *
 * @param {Object} rawEvent - Flat key/value object from the Redis stream (all strings).
 * @returns {{ valid: boolean, data: Object|null, error: string|null }}
 */
function validate(rawEvent) {
  if (!rawEvent || typeof rawEvent !== 'object') {
    return { valid: false, data: null, error: 'Event is not an object' };
  }

  // ── Check required fields are present (non-empty) ──────────────────────────
  for (const field of REQUIRED_FIELDS) {
    if (rawEvent[field] === undefined || rawEvent[field] === null || rawEvent[field] === '') {
      return { valid: false, data: null, error: `Missing required field: ${field}` };
    }
  }

  // ── Parse numeric fields ───────────────────────────────────────────────────
  const cpu          = parseFloat_(rawEvent.cpu);
  const memory       = parseFloat_(rawEvent.memory);
  const disk         = parseFloat_(rawEvent.disk);
  const health_score = parseInt_(rawEvent.health_score);

  if (isNaN(cpu))          return { valid: false, data: null, error: 'Field "cpu" is not a valid number' };
  if (isNaN(memory))       return { valid: false, data: null, error: 'Field "memory" is not a valid number' };
  if (isNaN(disk))         return { valid: false, data: null, error: 'Field "disk" is not a valid number' };
  if (isNaN(health_score)) return { valid: false, data: null, error: 'Field "health_score" is not a valid integer' };

  // ── Optional numeric fields (default to 0 / null if absent) ───────────────
  const network_in       = parseFloat_(rawEvent.network_in);
  const network_out      = parseFloat_(rawEvent.network_out);
  const load_avg_1m      = parseFloat_(rawEvent.load_avg_1m);
  const uptime_seconds   = parseFloat_(rawEvent.uptime_seconds);
  const process_crashed  = parseInt_(rawEvent.process_crashed);
  const process_high_cpu = parseInt_(rawEvent.process_high_cpu);
  const memory_used_mb   = parseFloat_(rawEvent.memory_used_mb);
  const disk_used_gb     = parseFloat_(rawEvent.disk_used_gb);

  // ── Parse JSON blob fields (optional) ─────────────────────────────────────
  let log_keywords   = null;
  let process_report = null;

  if (rawEvent.log_keywords) {
    try {
      log_keywords = JSON.parse(rawEvent.log_keywords);
    } catch {
      // Not valid JSON — store raw string in an array wrapper so downstream
      // code can always treat it as an array.
      log_keywords = [rawEvent.log_keywords];
    }
  }

  if (rawEvent.process_report) {
    // Keep as raw string — storageWriter will parse when inserting into Supabase.
    process_report = rawEvent.process_report;
  }

  // ── Build the normalized data object ──────────────────────────────────────
  const data = {
    agent_id:         rawEvent.agent_id,
    cpu,
    memory,
    disk,
    network_in:       isNaN(network_in)       ? 0    : network_in,
    network_out:      isNaN(network_out)      ? 0    : network_out,
    load_avg_1m:      isNaN(load_avg_1m)      ? null : load_avg_1m,
    uptime_seconds:   isNaN(uptime_seconds)   ? null : uptime_seconds,
    health_score,
    log_severity:     rawEvent.log_severity   || null,
    log_summary:      rawEvent.log_summary    || null,
    log_keywords,
    process_crashed:  isNaN(process_crashed)  ? 0    : process_crashed,
    process_high_cpu: isNaN(process_high_cpu) ? 0    : process_high_cpu,
    process_report,
    memory_used_mb:   isNaN(memory_used_mb)   ? null : memory_used_mb,
    disk_used_gb:     isNaN(disk_used_gb)     ? null : disk_used_gb,
    timestamp:        rawEvent.timestamp,
  };

  return { valid: true, data, error: null };
}

module.exports = { validate };
