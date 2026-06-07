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
const { requireAuth }       = require('../middleware/auth');
const { requireAdmin }      = require('../middleware/admin');
const { sseLimiter }        = require('../middleware/security');
const { logAuditEvent }     = require('../lib/audit');
const sseLib                = require('../lib/sse');
const {
  MAX_INCIDENTS_LIMIT,
  DEFAULT_INCIDENTS_LIMIT,
} = require('../config/constants');

const router = Router();

// ── GET /api/events — SSE stream ──────────────────────────────────────────────
// The frontend connects here once. The backend pushes events as they happen.
// Browser EventSource auto-reconnects on drop — no extra logic needed.
function openEventStream(channel) {
  return (req, res, next) => {
    try {
      res.setHeader('Content-Type',      'text/event-stream');
      res.setHeader('Cache-Control',     'no-cache, no-transform');
      res.setHeader('Connection',        'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.setHeader('Vary',              'Authorization, Cookie');

      sseLib.addClient(res, {
        user: req.user,
        channel,
        ip: req.ip,
      });

      res.flushHeaders();
      res.write(`event: connected\ndata: ${JSON.stringify({
        ts: Date.now(),
        role: req.user.role,
        channel,
      })}\n\n`);

      const heartbeat = setInterval(() => {
        try { res.write(': heartbeat\n\n'); } catch { clearInterval(heartbeat); }
      }, 25_000);

      const maxAge = setTimeout(() => {
        try { res.write('event: session:refresh\ndata: {}\n\n'); } catch {}
        res.end();
      }, 10 * 60_000);

      req.on('close', () => {
        clearInterval(heartbeat);
        clearTimeout(maxAge);
        sseLib.removeClient(res);
      });
    } catch (err) {
      next(err);
    }
  };
}

router.get('/events', sseLimiter, requireAuth, openEventStream('all'));
router.get('/events/servers', sseLimiter, requireAuth, openEventStream('servers'));
router.get('/events/incidents', sseLimiter, requireAuth, openEventStream('incidents'));
router.get('/events/diagnosis', sseLimiter, requireAuth, openEventStream('diagnosis'));



// ── GET /api/history ──────────────────────────────────────────────────────────
router.get('/history', requireAuth, asyncHandler(async (req, res) => {
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
router.get('/stats', requireAuth, asyncHandler(async (req, res) => {
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
router.get('/latest', requireAuth, asyncHandler(async (req, res) => {
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

router.post('/incidents/:id/ack', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  await logAuditEvent({
    actorId: req.user.id,
    action: 'incident.acknowledge',
    metadata: { incident_id: req.params.id, ip: req.ip },
  });
  res.json({ acknowledged: true, id: req.params.id });
}));

module.exports = router;
