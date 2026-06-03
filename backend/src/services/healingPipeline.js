'use strict';

/**
 * services/healingPipeline.js
 * Orchestrates the full AI → persist → broadcast → remediate flow
 * that runs when a server crosses critical thresholds.
 *
 * Extracted from routes/metrics.js for testability and separation of concerns.
 */

const { supabase, isSupabaseReady } = require('../lib/supabase');
const { getMetricsDiagnosis }       = require('./ai');
const { broadcast, broadcastServers }= require('../lib/ws');
const { setMemLatestDiagnosis }     = require('../lib/liveState');
const commandQueue                   = require('./commandQueue');

const ACTION_META = {
  restart_service: { label: 'Restart Service', icon: '🔄' },
  scale_up:        { label: 'Scale Up',         icon: '📈' },
  kill_process:    { label: 'Kill Process',     icon: '🔪' },
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Run the full healing pipeline for a server that has breached a critical threshold.
 *
 * Steps:
 *  1. Mark server → critical
 *  2. Mark server → recovering (LLM running)
 *  3. Call AI for diagnosis
 *  4. Persist ai_diagnoses row
 *  5. Persist incident row
 *  6. Enqueue remediation command for the agent
 *  7. Mark server → healthy
 *  8. Broadcast diagnosis to WS clients
 *
 * @param {{
 *   server_id:  string,
 *   serverName: string,
 *   cpuNum:     number,
 *   memNum:     number,
 *   logText:    string|null,
 *   timestamp:  string,
 * }} ctx
 * @returns {Promise<object>} healingResponse — sent back to the agent in the POST /api/metrics response
 */
async function runHealingPipeline(ctx) {
  const { server_id, serverName, cpuNum, memNum, logText, timestamp } = ctx;

  if (!isSupabaseReady()) {
    const err = new Error('Supabase required for the healing pipeline');
    err.status = 503;
    err.hint   = 'Set SUPABASE_URL and SUPABASE_KEY in your environment.';
    throw err;
  }

  // ── Step 1: Mark critical ────────────────────────────────────────────────
  await supabase.from('servers')
    .update({ status: 'critical', last_seen: new Date().toISOString() })
    .eq('id', server_id);
  broadcastServers();
  await sleep(400);

  // ── Step 2: Mark recovering ──────────────────────────────────────────────
  await supabase.from('servers')
    .update({ status: 'recovering', last_seen: new Date().toISOString() })
    .eq('id', server_id);
  broadcastServers();
  await sleep(250);

  // ── Step 3: AI diagnosis ─────────────────────────────────────────────────
  let diagnosis;
  try {
    diagnosis = await getMetricsDiagnosis({ serverName, cpu: cpuNum, memory: memNum, logs: logText });
  } catch (err) {
    // Restore critical status so the server shows as needing attention
    await supabase.from('servers')
      .update({ status: 'critical', last_seen: new Date().toISOString() })
      .eq('id', server_id);
    broadcastServers();
    throw err; // re-throw to route error handler
  }

  const actionMeta = ACTION_META[diagnosis.action] || ACTION_META.restart_service;

  // ── Step 4: Persist diagnosis ────────────────────────────────────────────
  const diagnosisRow = {
    server_id,
    root_cause:    diagnosis.root_cause,
    action:        diagnosis.action,
    action_detail: diagnosis.action_detail,
    confidence:    diagnosis.confidence,
    explanation:   diagnosis.explanation,
    model:         diagnosis.model,
    latency_ms:    diagnosis.latency_ms,
    cpu:           cpuNum,
    memory:        memNum,
    logs_excerpt:  logText ? String(logText).slice(0, 500) : null,
  };

  const { data: insertedDx, error: dxErr } = await supabase
    .from('ai_diagnoses').insert([diagnosisRow]).select().single();
  if (dxErr) console.warn('[Healing] ai_diagnoses insert failed:', dxErr.message);

  setMemLatestDiagnosis(
    insertedDx || { id: `local-${Date.now()}`, ...diagnosisRow, created_at: new Date().toISOString() }
  );

  // ── Step 5: Create incident ──────────────────────────────────────────────
  const { data: incident, error: incidentErr } = await supabase
    .from('incidents')
    .insert([{
      node:       serverName,
      type:       'ALERT',
      status:     'resolved',
      root_cause: diagnosis.root_cause,
      action:     `[${actionMeta.label}] ${diagnosis.action_detail}`,
      confidence: diagnosis.confidence,
      timestamp,
    }])
    .select().single();
  if (incidentErr) console.warn('[Healing] Incident insert failed:', incidentErr.message);

  const incidentId = incident?.id || null;

  // ── Step 6: Enqueue remediation for agent ────────────────────────────────
  try {
    commandQueue.enqueue(server_id, diagnosis.action, 'ai-healer');
  } catch (e) {
    console.warn('[Healing] Command enqueue failed:', e.message);
  }

  await sleep(800);

  // ── Step 7: Restore healthy ──────────────────────────────────────────────
  await supabase.from('servers')
    .update({ status: 'healthy', last_seen: new Date().toISOString() })
    .eq('id', server_id);
  broadcastServers();
  broadcast('events:update', null);

  // ── Step 8: Broadcast diagnosis ──────────────────────────────────────────
  const resolvedAt     = new Date().toISOString();
  const diagnosisPayload = {
    ...(insertedDx || diagnosisRow),
    server_name:  serverName,
    source:       diagnosis.source,
    action_label: actionMeta.label,
    action_icon:  actionMeta.icon,
    incident_id:  incidentId,
    resolved_at:  resolvedAt,
  };
  broadcast('diagnosis:new', diagnosisPayload);

  console.log(`[Healing] ✅ ${serverName}: ${diagnosis.action} (${diagnosis.confidence}% confidence, ${diagnosis.latency_ms}ms)`);

  return {
    stored:     true,
    status:     'critical',
    server_id,
    server:     serverName,
    ai_source:  diagnosis.source,
    model:      diagnosis.model,
    latency_ms: diagnosis.latency_ms,
    healing: {
      triggered:    true,
      action:       diagnosis.action,
      action_label: actionMeta.label,
      action_icon:  actionMeta.icon,
      action_detail:diagnosis.action_detail,
      root_cause:   diagnosis.root_cause,
      confidence:   diagnosis.confidence,
      explanation:  diagnosis.explanation,
      incident_id:  incidentId,
      resolved_at:  resolvedAt,
    },
  };
}

module.exports = { runHealingPipeline };
