#!/usr/bin/env node
'use strict';

require('dotenv').config();

const { collectMetrics }    = require('./collectors/metrics');
const { collectLogs }       = require('./collectors/logs');
const { collectProcesses }  = require('./collectors/processes');
const { computeHealthScore } = require('./health');
const {
  register,
  heartbeat,
  signPayload,
  getToken,
  getRegisteredAgentId,
} = require('./auth');
const RedisProducer = require('./transport/redisProducer');

const REDIS_URL          = process.env.REDIS_URL          || 'redis://localhost:6379';
const COLLECT_INTERVAL   = Number(process.env.COLLECT_INTERVAL_MS   || 10_000);
const HEARTBEAT_INTERVAL = Number(process.env.HEARTBEAT_INTERVAL_MS || 30_000);
const STREAM             = 'telemetry_stream';

/** Structured logger */
const log = (level, msg) =>
  console.log(`[${new Date().toISOString()}] [${level.padEnd(5)}] ${msg}`);

const producer = new RedisProducer(REDIS_URL);

/**
 * Collect all telemetry and publish one event to the stream.
 */
async function collect() {
  const agentId = getRegisteredAgentId();
  const token   = getToken();

  if (!agentId || !token) {
    log('WARN', 'Not registered yet — skipping collection');
    return;
  }

  try {
    const [metrics, logs, processes] = await Promise.all([
      collectMetrics(),
      collectLogs(),
      collectProcesses(),
    ]);

    const healthScore = computeHealthScore(metrics, logs, processes);

    const event = {
      agent_id:         agentId,
      cpu:              metrics.cpu,
      memory:           metrics.memory,
      memory_used_mb:   metrics.memoryUsedMb,
      disk:             metrics.disk,
      disk_used_gb:     metrics.diskUsedGb,
      network_in:       metrics.networkIn,
      network_out:      metrics.networkOut,
      load_avg_1m:      metrics.loadAvg1m,
      load_avg_5m:      metrics.loadAvg5m,
      uptime_seconds:   metrics.uptimeSeconds,
      health_score:     healthScore,
      log_severity:     logs.severity,
      log_summary:      logs.summary,
      log_keywords:     JSON.stringify(logs.matchedKeywords),
      process_crashed:  processes.crashed.length,
      process_high_cpu: processes.highCpu.length,
      process_report:   JSON.stringify(processes.report),
      timestamp:        new Date().toISOString(),
    };

    await producer.publish(STREAM, event);

    log(
      'INFO',
      `Telemetry published — CPU: ${metrics.cpu.toFixed(1)}% | MEM: ${metrics.memory.toFixed(1)}% | Health: ${healthScore}/100`,
    );
  } catch (err) {
    log('ERROR', `Collection failed: ${err.message}`);
  }
}

/**
 * Graceful shutdown handler.
 */
async function shutdown(signal) {
  log('INFO', `Received ${signal} — shutting down...`);
  await producer.disconnect();
  process.exit(0);
}

/**
 * Main entry point.
 */
async function main() {
  console.log(`
  ╔══════════════════════════════════════╗
  ║    SelfHeal Agent v1.0               ║
  ║    Distributed Telemetry Agent       ║
  ╚══════════════════════════════════════╝

  Backend  : ${process.env.BACKEND_URL || 'http://localhost:8000'}
  Redis    : ${REDIS_URL}
  Stream   : ${STREAM}
  Interval : every ${COLLECT_INTERVAL / 1000}s
  `);

  // Connect to Redis
  log('INFO', 'Connecting to Redis...');
  await producer.connect();
  log('OK   ', 'Redis connected');

  // Register with backend — retry indefinitely until successful
  let registered = false;
  while (!registered) {
    try {
      const { agentId } = await register();
      log('OK   ', `Agent registered — ID: ${agentId}`);
      registered = true;
    } catch (err) {
      log('ERROR', `Registration failed: ${err.message} — retrying in 15s`);
      await new Promise(r => setTimeout(r, 15_000));
    }
  }

  // Initial collection after a short warm-up delay
  setTimeout(collect, 2_000);

  // Periodic collection loop
  setInterval(collect, COLLECT_INTERVAL);

  // Heartbeat loop
  setInterval(heartbeat, HEARTBEAT_INTERVAL);

  // Graceful shutdown
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  log('OK   ', 'Agent running. Press Ctrl+C to stop.');
}

main().catch(err => {
  console.error(`[FATAL] ${err.message}`);
  process.exit(1);
});
