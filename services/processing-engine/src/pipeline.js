'use strict';

/**
 * pipeline.js
 * Orchestrates the full telemetry processing pipeline:
 *   validate -> normalize -> write telemetry -> update agent -> detect anomalies -> create incidents
 */

const { validate }          = require('./validator');
const { normalize }         = require('./normalizer');
const { writeTelemetry, updateAgentStatus } = require('./storageWriter');
const { detectAnomalies }   = require('./anomalyDetector');
const { createIncidents }   = require('./incidentManager');

const log = (level, msg) =>
  console.log(`[${new Date().toISOString()}] [${level}] [pipeline] ${msg}`);

/**
 * Process a single raw telemetry event through the full pipeline.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Object} rawEvent - Flat key/value object from the Redis stream (all strings)
 * @returns {Promise<{ processed: boolean, incidents: number }>}
 */
async function processTelemetryEvent(supabase, rawEvent) {
  // -- Step 1: Validate
  const { valid, data, error } = validate(rawEvent);
  if (!valid) {
    log('WARN', `Validation failed -- ${error}. Event: ${JSON.stringify(rawEvent)}`);
    return { processed: false, incidents: 0 };
  }

  // -- Step 2: Normalize
  const normalized = normalize(data);

  // -- Step 3: Write telemetry
  try {
    await writeTelemetry(supabase, normalized);
  } catch (err) {
    log('ERROR', `writeTelemetry failed for agent ${normalized.agent_id}: ${err.message}`);
    // Continue -- a storage failure should not block anomaly detection.
  }

  // -- Step 4: Update agent status + cache latest metrics on the agents row
  try {
    await updateAgentStatus(supabase, normalized.agent_id, normalized.health_score, {
      cpu:    normalized.cpu,
      memory: normalized.memory,
      disk:   normalized.disk,
    });
  } catch (err) {
    log('ERROR', `updateAgentStatus failed for agent ${normalized.agent_id}: ${err.message}`);
  }

  // -- Step 5: Detect anomalies
  const incidents = detectAnomalies(normalized);
  if (incidents.length > 0) {
    log('INFO', `Detected ${incidents.length} anomaly(ies) for agent ${normalized.agent_id}`);
  }

  // -- Step 6: Create incidents
  let created = 0;
  if (incidents.length > 0) {
    try {
      created = await createIncidents(supabase, incidents);
    } catch (err) {
      log('ERROR', `createIncidents threw unexpectedly: ${err.message}`);
    }
  }

  log('INFO', `Processed agent=${normalized.agent_id} health=${normalized.health_score} cpu=${normalized.cpu}% mem=${normalized.memory}% incidents_created=${created}`);

  return { processed: true, incidents: created };
}

module.exports = { processTelemetryEvent };
