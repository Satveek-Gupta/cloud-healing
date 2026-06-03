'use strict';

/**
 * config/failureTypes.js
 * Canonical failure type definitions used by the AI service mock fallbacks.
 */

module.exports = Object.freeze({
  HIGH_CPU: {
    id:       'HIGH_CPU',
    label:    'High CPU',
    icon:     '🔥',
    logLines: [
      '[CRIT] CPU at 97% — scheduler starvation detected',
      '[ERROR] Worker thread pool exhausted (32/32)',
      '[ERROR] Request queue depth: 1842 — latency P99: 4200ms',
      '[WARN] Auto-scaler throttled: quota limit reached',
    ],
    metrics: { cpuUsage: '97%', memoryUsage: '61%', uptime: '99.1%' },
  },
  HIGH_ERROR_RATE: {
    id:       'HIGH_ERROR_RATE',
    label:    'Error Surge',
    icon:     '💥',
    logLines: [
      '[CRIT] HTTP 503 rate: 34% of requests in last 60s',
      '[ERROR] Upstream timeout: payments-svc (attempt 3/3)',
      '[ERROR] Circuit breaker OPEN on /api/checkout',
      '[WARN] Retry storm detected — exponential backoff engaged',
    ],
    metrics: { cpuUsage: '58%', memoryUsage: '74%', uptime: '97.8%' },
  },
  MEMORY_LEAK: {
    id:       'MEMORY_LEAK',
    label:    'Memory Leak',
    icon:     '💾',
    logLines: [
      '[CRIT] OOM kill triggered — PID 4821 terminated',
      '[ERROR] Heap exhausted: 16384 MB / 16384 MB used',
      '[ERROR] GC overhead limit exceeded — JVM halted',
      '[WARN] Memory growth rate: +120 MB/min over last 30m',
    ],
    metrics: { cpuUsage: '44%', memoryUsage: '99%', uptime: '98.6%' },
  },
});
