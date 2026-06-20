'use strict';

/**
 * storageWriter.js
 * Handles all writes to Supabase for telemetry data and agent status.
 */

const log = (level, msg) =>
  console.log(`[${new Date().toISOString()}] [${level}] [storageWriter] ${msg}`);

/**
 * Insert a normalized telemetry event into the `telemetry` table.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Object} data - Normalized telemetry event
 * @returns {Promise<void>}
 */
async function writeTelemetry(supabase, data) {
  // Safely parse process_report — it may already be an object or a JSON string.
  let process_report = null;
  if (data.process_report) {
    if (typeof data.process_report === 'object') {
      process_report = data.process_report;
    } else {
      try {
        process_report = JSON.parse(data.process_report);
      } catch {
        // Store as a plain string wrapper to avoid data loss.
        process_report = { raw: data.process_report };
      }
    }
  }

  const row = {
    agent_id:       data.agent_id,
    cpu:            data.cpu,
    memory:         data.memory,
    disk:           data.disk,
    network_in:     data.network_in  ?? 0,
    network_out:    data.network_out ?? 0,
    uptime:         data.uptime_seconds  ?? null,
    load_avg:       data.load_avg_1m     ?? null,
    health_score:   data.health_score,
    log_summary:    data.log_summary     ?? null,
    process_report,
    timestamp:      data.timestamp,
  };

  const { error } = await supabase.from('telemetry').insert(row);
  if (error) {
    log('ERROR', `Failed to write telemetry for agent ${data.agent_id}: ${error.message}`);
    throw error;
  }

  log('DEBUG', `Telemetry written for agent ${data.agent_id} at ${data.timestamp}`);
}

/**
 * Update the `agents` table with the latest heartbeat, derived status,
 * and latest metric snapshot for fast dashboard display (no telemetry join needed).
 *
 * Status derivation:
 *   health_score > 70  → 'healthy'
 *   health_score > 40  → 'degraded'
 *   otherwise          → 'critical'
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} agentId
 * @param {number} healthScore
 * @param {Object} [metrics] - Latest metric values to cache on the agent row
 * @returns {Promise<void>}
 */
async function updateAgentStatus(supabase, agentId, healthScore, metrics = {}) {
  const status = healthScore > 70 ? 'healthy' : healthScore > 40 ? 'degraded' : 'critical';

  const update = {
    last_seen:    new Date().toISOString(),
    status,
    health_score: healthScore,
    // Cache latest metric snapshot so the dashboard card doesn't need a join
    ...(metrics.cpu    != null && { cpu:    Number(Number(metrics.cpu).toFixed(2))    }),
    ...(metrics.memory != null && { memory: Number(Number(metrics.memory).toFixed(2)) }),
    ...(metrics.disk   != null && { disk:   Number(Number(metrics.disk).toFixed(2))   }),
  };

  const { error } = await supabase
    .from('agents')
    .update(update)
    .eq('agent_id', agentId);

  if (error) {
    // Fallback: if columns like 'cpu' don't exist, retry with basic columns
    const errorMsg = error.message.toLowerCase();
    if (errorMsg.includes('column') && (errorMsg.includes('does not exist') || errorMsg.includes('not found'))) {
      log('WARN', `Metrics cache columns missing on agents table. Retrying status-only update for ${agentId}.`);
      const { error: retryError } = await supabase
        .from('agents')
        .update({
          last_seen: new Date().toISOString(),
          status,
        })
        .eq('agent_id', agentId);

      if (retryError) {
        log('ERROR', `Failed fallback status update for ${agentId}: ${retryError.message}`);
        throw retryError;
      }
    } else {
      log('ERROR', `Failed to update agent status for ${agentId}: ${error.message}`);
      throw error;
    }
  }

  log('DEBUG', `Agent ${agentId} status → ${status} (health: ${healthScore})`);
}

module.exports = { writeTelemetry, updateAgentStatus };
