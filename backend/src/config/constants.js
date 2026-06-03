'use strict';

/**
 * config/constants.js
 * All shared magic numbers and string lists in one place.
 * Import this — never hardcode these values in routes or services.
 */

module.exports = Object.freeze({
  // ── Server staleness ─────────────────────────────────────────────────────────────────────
  /** ms without a heartbeat before a server is marked offline */
  STALE_THRESHOLD_MS: 90_000,   // 90s — 3 missed 30s scrape cycles
  /** how often the WS hub checks for stale servers (legacy, kept for compat) */
  STALE_CHECK_MS:     30_000,

  // ── Node Exporter scraper ─────────────────────────────────────────────────────────
  /** How often the backend scrapes each server's :9100/metrics */
  SCRAPE_INTERVAL_MS:    30_000,
  /** Per-server HTTP fetch timeout */
  SCRAPE_TIMEOUT_MS:     10_000,
  /** Default node_exporter port */
  DEFAULT_EXPORTER_PORT: 9100,

  // ── AI thresholds ────────────────────────────────────────────────────────
  /** CPU % that triggers the AI healing pipeline */
  CPU_CRITICAL:    85,
  /** Memory % that triggers mock "high_memory" diagnosis */
  MEMORY_CRITICAL: 95,

  // ── Commands ─────────────────────────────────────────────────────────────
  ALLOWED_COMMANDS: Object.freeze([
    'restart_service',
    'scale_up',
    'kill_process',
    'stress_cpu',
    'process_crash',
  ]),

  // ── Pagination ───────────────────────────────────────────────────────────
  MAX_METRICS_LIMIT:      200,
  DEFAULT_METRICS_LIMIT:  50,
  MAX_INCIDENTS_LIMIT:    100,
  DEFAULT_INCIDENTS_LIMIT:50,
});
