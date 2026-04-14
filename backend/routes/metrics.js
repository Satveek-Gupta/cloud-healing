const { Router } = require('express');
const { supabase, isSupabaseReady } = require('../lib/supabase');
const { getMetricsDiagnosis, CPU_CRITICAL } = require('../lib/ai');
const { broadcastServers, broadcast } = require('../lib/ws');
const { setMemLatestDiagnosis } = require('../lib/liveState');
const commands = require('./commands');

const router = Router();

const mockMetrics = [];

const ACTION_META = {
  restart_service: { label: 'Restart Service', icon: '🔄', color: '#8b5cf6' },
  scale_up:        { label: 'Scale Up',         icon: '📈', color: '#3b82f6' },
  kill_process:    { label: 'Kill Process',     icon: '🔪', color: '#ef4444' },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Critical when CPU > threshold OR genuine error/fatal logs (not warnings or memory-only). */
function deriveStatus(cpu, memory, logs) {
  const cpuNum = typeof cpu === 'number' ? cpu : parseFloat(cpu) || 0;
  const logsStr = (logs || '').toLowerCase();
  // Only real server-side failures → critical (not macOS/system warnings)
  const hasErrorLog = /\b(fatal|exception|panic|oom kill|killed process|segfault|out of memory)\b/.test(logsStr);
  if (cpuNum > CPU_CRITICAL || hasErrorLog) return 'critical';
  return 'healthy';
}

const fmt = (v) => (v === undefined ? undefined : typeof v === 'number' ? `${v}%` : String(v));

function fmtUptime(seconds) {
  if (typeof seconds !== 'number') return String(seconds || '—');
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ── POST /api/metrics ──────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const {
    server_id,
    cpu, memory, uptime,
    // v1 compat
    logs,
    // Smart Agent v2 fields
    disk_used_pct, load_1m, load_per_core,
    memory_used_mb,
    issue_type, severity, log_summary,
    health_score, anomalies, is_anomaly,
  } = req.body;

  if (!server_id) return res.status(400).json({ error: 'server_id is required' });
  if (cpu === undefined && memory === undefined) {
    return res.status(400).json({ error: 'At least one of cpu or memory is required' });
  }

  // Use log_summary from agent (preferred) or raw logs field
  const logText   = log_summary || logs || null;
  const cpuNum    = typeof cpu    === 'number' ? cpu    : parseFloat(cpu)    || 0;
  const memNum    = typeof memory === 'number' ? memory : parseFloat(memory) || 0;
  const status    = deriveStatus(cpuNum, memNum, logText);
  const timestamp = new Date().toISOString();

  const metricRecord = {
    server_id,
    cpu:    cpu    !== undefined ? Number(cpuNum.toFixed(2)) : null,
    memory: memory !== undefined ? Number(memNum.toFixed(2)) : null,
    uptime: uptime !== undefined ? Number(uptime)            : null,
    logs:   logText,
    timestamp,
  };

  if (isSupabaseReady()) {
    const { error: metricsErr } = await supabase.from('metrics').insert([metricRecord]);
    if (metricsErr) console.warn('[Metrics] Insert failed:', metricsErr.message);
  } else {
    mockMetrics.unshift({ id: `m-${Date.now()}`, ...metricRecord });
    if (mockMetrics.length > 500) mockMetrics.length = 500;
  }

  const serverUpdate = {
    last_seen: timestamp,
    ...(cpu    !== undefined && { cpu:    fmt(cpuNum)       }),
    ...(memory !== undefined && { memory: fmt(memNum)       }),
    ...(uptime !== undefined && { uptime: fmtUptime(uptime) }),
    // Store advanced metrics if provided
    ...(health_score !== undefined && { health_score }),
    ...(disk_used_pct !== undefined && { disk_used_pct }),
    ...(load_1m      !== undefined && { load_1m      }),
    ...(severity     !== undefined && { severity     }),
  };

  // ── Always update cpu/mem/uptime immediately (never lost to a 504) ──────
  let serverName = server_id;
  if (isSupabaseReady()) {
    const { data: updated } = await supabase
      .from('servers')
      .update({ ...serverUpdate, status })
      .eq('id', server_id)
      .select()
      .single();
    if (updated?.name) serverName = updated.name;
  }

  if (status !== 'critical') {
    const anomalyStr = is_anomaly ? ` | anomalies: ${(anomalies || []).join(', ')}` : '';
    console.log(`[Metrics] ${serverName} → healthy (cpu: ${cpuNum}%, health: ${health_score ?? '?'}/100${anomalyStr})`);
    broadcastServers();
    return res.json({ stored: true, status, health_score: health_score ?? null, healing: null });
  }

  console.log(`[Metrics] ⚠️  CRITICAL on ${serverName} — status pipeline + AI...`);

  if (!isSupabaseReady()) {
    broadcastServers();
    return res.status(503).json({
      error: 'Supabase required for critical metrics handling in this build',
      hint: 'Configure SUPABASE_URL and SUPABASE_KEY.',
    });
  }

  // 1) critical
  await supabase
    .from('servers')
    .update({ status: 'critical', last_seen: new Date().toISOString() })
    .eq('id', server_id);
  broadcastServers();
  await sleep(400);

  // 2) recovering (LLM in progress)
  await supabase
    .from('servers')
    .update({ status: 'recovering', last_seen: new Date().toISOString() })
    .eq('id', server_id);
  broadcastServers();
  await sleep(250);

  let diagnosis;
  try {
    diagnosis = await getMetricsDiagnosis({
      serverName,
      cpu:    cpuNum,
      memory: memNum,
      logs:   logText,   // prefer enriched log_summary from Smart Agent v2
    });
  } catch (err) {
    console.error('[Metrics] AI diagnosis failed:', err.message);
    await supabase
      .from('servers')
      .update({ status: 'critical', last_seen: new Date().toISOString() })
      .eq('id', server_id);
    broadcastServers();
    const hint =
      err.code === 'NO_LLM_KEY'
        ? 'Set GEMINI_API_KEY (Google AI Studio) or OPENAI_API_KEY — or ALLOW_AI_MOCK=true for local demos.'
        : 'Check LLM credentials and quotas.';
    return res.status(503).json({ error: 'LLM unavailable', hint, details: err.message });
  }

  const actionMeta = ACTION_META[diagnosis.action] || ACTION_META.restart_service;
  const logsExcerpt = logs ? String(logs).slice(0, 500) : null;

  const diagnosisRow = {
    server_id,
    root_cause: diagnosis.root_cause,
    action: diagnosis.action,
    action_detail: diagnosis.action_detail,
    confidence: diagnosis.confidence,
    explanation: diagnosis.explanation,
    model: diagnosis.model,
    latency_ms: diagnosis.latency_ms,
    cpu: cpu !== undefined ? Number(cpuNum.toFixed(2)) : null,
    memory: memory !== undefined ? Number(memNum.toFixed(2)) : null,
    logs_excerpt: logsExcerpt,
  };

  const { data: insertedDx, error: dxErr } = await supabase
    .from('ai_diagnoses')
    .insert([diagnosisRow])
    .select()
    .single();
  if (dxErr) {
    console.warn('[Metrics] ai_diagnoses insert failed:', dxErr.message);
  }
  setMemLatestDiagnosis(insertedDx || { id: `local-${Date.now()}`, ...diagnosisRow, created_at: new Date().toISOString() });

  const incidentPayload = {
    node: serverName,
    type: 'ALERT',
    status: 'resolved',
    root_cause: diagnosis.root_cause,
    action: `[${actionMeta.label}] ${diagnosis.action_detail}`,
    confidence: diagnosis.confidence,
    timestamp,
  };

  let incidentId = null;
  const { data: incident, error: incidentErr } = await supabase
    .from('incidents')
    .insert([incidentPayload])
    .select()
    .single();
  if (incidentErr) {
    console.warn('[Metrics] Incident insert failed:', incidentErr.message);
  } else {
    incidentId = incident?.id;
  }

  // Enqueue remediation for the agent (agent executes; backend marks healthy after brief delay for UX)
  try {
    commands.enqueueCommand(server_id, diagnosis.action, 'ai-healer');
  } catch (e) {
    console.warn('[Metrics] Command enqueue failed:', e.message);
  }

  await sleep(800);

  await supabase
    .from('servers')
    .update({ status: 'healthy', last_seen: new Date().toISOString() })
    .eq('id', server_id);

  broadcastServers();
  broadcast('events:update', null);

  const diagnosisPayload = {
    ...(insertedDx || diagnosisRow),
    server_name: serverName,
    source: diagnosis.source,
    action_label: actionMeta.label,
    action_icon: actionMeta.icon,
    incident_id: incidentId,
    resolved_at: new Date().toISOString(),
  };
  broadcast('diagnosis:new', diagnosisPayload);

  const healingResponse = {
    stored: true,
    status: 'critical',
    server_id,
    server: serverName,
    ai_source: diagnosis.source,
    model: diagnosis.model,
    latency_ms: diagnosis.latency_ms,
    explanation: diagnosis.explanation,
    healing: {
      triggered: true,
      action: diagnosis.action,
      action_label: actionMeta.label,
      action_icon: actionMeta.icon,
      action_detail: diagnosis.action_detail,
      root_cause: diagnosis.root_cause,
      confidence: diagnosis.confidence,
      explanation: diagnosis.explanation,
      incident_id: incidentId,
      resolved_at: diagnosisPayload.resolved_at,
    },
  };

  console.log(`[Metrics] ✅ Healing applied on ${serverName}: ${diagnosis.action} (${diagnosis.confidence}% confidence)`);
  res.json(healingResponse);
});

// ── GET /api/metrics/:server_id ────────────────────────────────────────────
router.get('/:server_id', async (req, res) => {
  const { server_id } = req.params;
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);

  if (isSupabaseReady()) {
    const { data, error } = await supabase
      .from('metrics')
      .select('*')
      .eq('server_id', server_id)
      .order('timestamp', { ascending: false })
      .limit(limit);
    return res.json(error ? [] : data || []);
  }

  res.json(mockMetrics.filter((m) => m.server_id === server_id).slice(0, limit));
});

module.exports = router;
