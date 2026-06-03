'use strict';

/**
 * routes/incidents.js
 * Real incident history, cluster stats, and SSE event stream.
 *
 * GET /api/events   → SSE stream — push-based live updates to the frontend
 * GET /api/history  → paginated incident log
 * GET /api/stats    → cluster-level aggregate stats
 * GET /api/latest   → full dashboard snapshot (servers + latest diagnosis)
 */

const { Router }            = require('express');
const { supabase, isSupabaseReady } = require('../lib/supabase');
const { getMemLatestDiagnosis } = require('../lib/liveState');
const { applyOnlineStatus } = require('../services/serverStatus');
const { asyncHandler }      = require('../middleware/errorHandler');
const sseLib                = require('../lib/sse');
const {
  MAX_INCIDENTS_LIMIT,
  DEFAULT_INCIDENTS_LIMIT,
} = require('../config/constants');

const router = Router();

// ── GET /api/events — SSE stream ──────────────────────────────────────────────
// The frontend connects here once. The backend pushes events as they happen.
// Browser EventSource auto-reconnects on drop — no extra logic needed.
router.get('/events', (req, res) => {
  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache, no-transform');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable Nginx proxy buffering
  res.flushHeaders();

  // Confirm connection to the client
  res.write(`event: connected\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);

  sseLib.addClient(res);

  // Heartbeat every 25s — keeps connection alive through proxies and load balancers
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { clearInterval(heartbeat); }
  }, 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseLib.removeClient(res);
  });
});



// ── GET /api/history ──────────────────────────────────────────────────────────
router.get('/history', asyncHandler(async (req, res) => {
  const limit = Math.min(
    parseInt(req.query.limit, 10) || DEFAULT_INCIDENTS_LIMIT,
    MAX_INCIDENTS_LIMIT
  );

  if (!isSupabaseReady()) return res.json([]);

  const { data, error } = await supabase
    .from('incidents').select('*').order('timestamp', { ascending: false }).limit(limit);
  if (error) throw Object.assign(new Error(error.message), { status: 502 });
  res.json(data || []);
}));

// ── GET /api/stats ────────────────────────────────────────────────────────────
router.get('/stats', asyncHandler(async (req, res) => {
  if (!isSupabaseReady()) {
    return res.json({ healingEvents: 0, cpuUsage: '—', memoryUsage: '—', uptime: '—' });
  }

  const [healingRes, serverRes] = await Promise.all([
    supabase.from('incidents').select('id', { count: 'exact' }).eq('type', 'HEALING'),
    supabase.from('servers').select('cpu, memory, uptime').eq('status', 'healthy'),
  ]);

  const healingCount = healingRes.count ?? healingRes.data?.length ?? 0;
  const servers      = serverRes.data || [];

  // Compute fleet averages from live server rows
  const avgCpu = servers.length
    ? Math.round(servers.reduce((s, r) => s + (parseFloat(r.cpu) || 0), 0) / servers.length)
    : null;
  const avgMem = servers.length
    ? Math.round(servers.reduce((s, r) => s + (parseFloat(r.memory) || 0), 0) / servers.length)
    : null;

  res.json({
    healingEvents: healingCount,
    cpuUsage:      avgCpu  !== null ? `${avgCpu}%`  : '—',
    memoryUsage:   avgMem  !== null ? `${avgMem}%`  : '—',
    uptime:        servers.length   ? servers[0].uptime || '—' : '—',
  });
}));

// ── GET /api/latest ───────────────────────────────────────────────────────────
router.get('/latest', asyncHandler(async (req, res) => {
  if (!isSupabaseReady()) {
    return res.json({ servers: [], latest_diagnosis: getMemLatestDiagnosis() });
  }

  const [serversRes, diagRes] = await Promise.all([
    supabase.from('servers').select('*').order('last_seen', { ascending: false }),
    supabase.from('ai_diagnoses').select('*').order('created_at', { ascending: false }).limit(1),
  ]);

  const servers          = (serversRes.data || []).map(applyOnlineStatus);
  const latest_diagnosis = diagRes.data?.[0] || getMemLatestDiagnosis() || null;

  res.json({ servers, latest_diagnosis });
}));

module.exports = router;
