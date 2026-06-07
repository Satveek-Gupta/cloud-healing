'use strict';

/**
 * routes/metrics.js
 * Agent metric ingestion and history retrieval.
 *
 * POST /api/metrics        → ingest a metric snapshot from an agent
 * GET  /api/metrics/:id    → fetch metric history for a server
 */

const { Router }            = require('express');
const { supabase, isSupabaseReady } = require('../lib/supabase');
const { CPU_CRITICAL }      = require('../services/ai');
const { broadcastServers, broadcast } = require('../lib/ws');

const { setMemLatestDiagnosis } = require('../lib/liveState');
const { runHealingPipeline }= require('../services/healingPipeline');
const { asyncHandler }      = require('../middleware/errorHandler');
const { validateBody }      = require('../middleware/validate');
const { requireAuth }       = require('../middleware/auth');
const {
  MAX_METRICS_LIMIT,
  DEFAULT_METRICS_LIMIT,
} = require('../config/constants');

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────
/** Format a numeric value as "XX%" string for storage in the servers table. */
const fmtPct = v => (typeof v === 'number' ? `${v.toFixed(2)}%` : String(v));

/** Format uptime seconds into a human-readable string. */
function fmtUptime(seconds) {
  if (typeof seconds !== 'number') return String(seconds || '—');
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/**
 * Derive server status from metrics.
 * Only marks critical when CPU is very high OR error-level logs exist.
 * High memory alone → healthy (handled in the healing pipeline separately).
 */
function deriveStatus(cpu, logs) {
  const logsStr = (logs || '').toLowerCase();
  const hasErrorLog = /\b(error|critical|crit|fatal|exception|panic|oom|killed)\b/.test(logsStr);
  if (cpu > CPU_CRITICAL || hasErrorLog) return 'critical';
  return 'healthy';
}

// ── POST /api/metrics ─────────────────────────────────────────────────────────
router.post(
  '/',
  validateBody({ server_id: 'string' }),
  asyncHandler(async (req, res) => {
    const {
      server_id,
      cpu, memory, uptime,
      // Smart Agent v2 enriched fields
      log_summary, logs,
      disk_used_pct, load_1m, load_per_core,
      memory_used_mb,
      issue_type, severity, health_score,
      anomalies, is_anomaly,
    } = req.body;

    if (cpu === undefined && memory === undefined) {
      return res.status(400).json({ error: 'At least one of cpu or memory is required' });
    }

    const logText  = log_summary || logs || null;
    const cpuNum   = typeof cpu    === 'number' ? cpu    : parseFloat(cpu)    || 0;
    const memNum   = typeof memory === 'number' ? memory : parseFloat(memory) || 0;
    const status   = deriveStatus(cpuNum, logText);
    const timestamp = new Date().toISOString();

    // ── Persist metric row ──────────────────────────────────────────────────
    const metricRecord = {
      server_id,
      cpu:       cpuNum  !== undefined ? Number(cpuNum.toFixed(2))  : null,
      memory:    memNum  !== undefined ? Number(memNum.toFixed(2))  : null,
      uptime:    uptime  !== undefined ? Number(uptime)             : null,
      logs:      logText,
      timestamp,
    };

    if (isSupabaseReady()) {
      const { error } = await supabase.from('metrics').insert([metricRecord]);
      if (error) console.warn('[Metrics] Insert failed:', error.message);
    }

    // ── Update server row ───────────────────────────────────────────────────
    const serverUpdate = {
      status,
      last_seen: timestamp,
      ...(cpu           !== undefined && { cpu:          fmtPct(cpuNum)       }),
      ...(memory        !== undefined && { memory:       fmtPct(memNum)       }),
      ...(uptime        !== undefined && { uptime:       fmtUptime(uptime)    }),
      ...(health_score  !== undefined && { health_score                       }),
      ...(disk_used_pct !== undefined && { disk_used_pct                      }),
      ...(load_1m       !== undefined && { load_1m                            }),
      ...(severity      !== undefined && { severity                           }),
    };

    let serverName = server_id;
    if (isSupabaseReady()) {
      const { data: updated } = await supabase
        .from('servers').update(serverUpdate).eq('id', server_id).select().single();
      if (updated?.name) serverName = updated.name;
    }

    // ── Healthy path: quick response ──────────────────────────────────────────────
    if (status !== 'critical') {
      const anomalyStr = is_anomaly ? ` | anomalies: ${(anomalies || []).join(', ')}` : '';
      console.log(`[Metrics] ${serverName} → healthy (cpu: ${cpuNum}%, health: ${health_score ?? '?'}/100${anomalyStr})`);
      // Broadcast just the changed row — no extra DB query needed
      if (isSupabaseReady()) {
        const { data: updatedRow } = await supabase
          .from('servers').select('*').eq('id', server_id).single();
        if (updatedRow) broadcast('server:updated', updatedRow);
      }
      return res.json({ stored: true, status, health_score: health_score ?? null, healing: null });
    }

    // ── Critical path: run healing pipeline ─────────────────────────────────
    console.log(`[Metrics] ⚠️  CRITICAL on ${serverName} — starting healing pipeline`);
    try {
      const result = await runHealingPipeline({ server_id, serverName, cpuNum, memNum, logText, timestamp });
      return res.json(result);
    } catch (err) {
      console.error('[Metrics] Healing pipeline failed:', err.message);
      return res.status(err.status || 503).json({
        error:  err.message,
        hint:   err.hint,
        stored: true,
        status: 'critical',
      });
    }
  })
);

// ── GET /api/metrics/:server_id ───────────────────────────────────────────────
router.get('/:server_id', requireAuth, asyncHandler(async (req, res) => {
  const limit = Math.min(
    parseInt(req.query.limit, 10) || DEFAULT_METRICS_LIMIT,
    MAX_METRICS_LIMIT
  );

  if (!isSupabaseReady()) return res.json([]);

  const { data, error } = await supabase
    .from('metrics')
    .select('*')
    .eq('server_id', req.params.server_id)
    .order('timestamp', { ascending: false })
    .limit(limit);

  if (error) throw Object.assign(new Error(error.message), { status: 502 });
  res.json(data || []);
}));

module.exports = router;
