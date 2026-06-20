'use strict';

/**
 * routes/agents.js
 * Agent registration, heartbeat, and telemetry endpoints.
 *
 * POST /api/agents/register    → bootstrap: register or re-register an agent
 * POST /api/agents/heartbeat   → agent keepalive (HMAC-signed)
 * POST /api/agents/telemetry   → push metrics to Redis stream (HMAC-signed)
 * GET  /api/agents             → list all agents (requireAuth)
 * GET  /api/agents/:id         → single agent detail + telemetry + incidents (requireAuth)
 */

const crypto  = require('crypto');
const { Router } = require('express');

const { supabase, isSupabaseReady } = require('../lib/supabase');
const { getRedis }                  = require('../lib/redis');
const { RedisStreamProducer }       = require('../lib/eventBus/redisAdapter');
const { asyncHandler }              = require('../middleware/errorHandler');
const { validateBody }              = require('../middleware/validate');
const { requireAuth }               = require('../middleware/auth');
const { verifyAgentSignature }      = require('../middleware/agentAuth');

const router = Router();

// ── POST /api/agents/register ─────────────────────────────────────────────────
// No auth — this is the bootstrap endpoint for freshly-deployed agents.
router.post(
  '/register',
  validateBody({
    agent_id:         'string',
    hostname:         'string',
    operating_system: 'string?',
    ip_address:       'string?',
    environment:      'string?',
    version:          'string?',
  }),
  asyncHandler(async (req, res) => {
    const { agent_id, hostname, operating_system, ip_address, environment, version } = req.body;
    const now = new Date().toISOString();

    if (!isSupabaseReady()) {
      // Dev/mock mode — return a deterministic token so agents can still run
      const mockToken = crypto.createHash('sha256').update(agent_id).digest('hex');
      return res.status(201).json({
        agent_id,
        token:         mockToken,
        registered_at: now,
        message:       'Registered (mock mode — Supabase not configured)',
      });
    }

    // Check if agent already exists to decide whether to rotate the token
    const { data: existing } = await supabase
      .from('agents')
      .select('agent_id, token, created_at')
      .eq('agent_id', agent_id)
      .maybeSingle();

    const token = existing?.token ?? crypto.randomBytes(32).toString('hex');

    const upsertPayload = {
      agent_id,
      hostname,
      os:          operating_system || null,
      ip:          ip_address       || null,
      environment: environment      || 'production',
      version:     version          || '1.0.0',
      token,
      last_seen:   now,
      status:      'online',
    };

    const { data, error } = await supabase
      .from('agents')
      .upsert(upsertPayload, { onConflict: 'agent_id' })
      .select()
      .single();

    if (error) throw Object.assign(new Error(error.message), { status: 502 });

    return res.status(existing ? 200 : 201).json({
      agent_id:      data.agent_id,
      token:         data.token,
      registered_at: data.created_at || now,
      message:       existing
        ? 'Agent re-registered — token unchanged'
        : 'Agent registered successfully',
    });
  })
);

// ── POST /api/agents/heartbeat ────────────────────────────────────────────────
router.post(
  '/heartbeat',
  verifyAgentSignature,
  validateBody({ agent_id: 'string', timestamp: 'string?' }),
  asyncHandler(async (req, res) => {
    const { agent_id } = req.body;
    const now = new Date().toISOString();

    if (!isSupabaseReady()) return res.json({ ok: true });

    const { error } = await supabase
      .from('agents')
      .update({ last_seen: now, status: 'online' })
      .eq('agent_id', agent_id);

    if (error) throw Object.assign(new Error(error.message), { status: 502 });

    res.json({ ok: true });
  })
);

// ── POST /api/agents/telemetry ────────────────────────────────────────────────
router.post(
  '/telemetry',
  verifyAgentSignature,
  validateBody({ agent_id: 'string' }),
  asyncHandler(async (req, res) => {
    const {
      agent_id, cpu, memory, disk, health_score,
      logs, timestamp, network_in, network_out, uptime, load_avg, process_report,
    } = req.body;

    const now = timestamp || new Date().toISOString();

    // ── 1. Try Redis Streams first ────────────────────────────────────────────
    const redisClient = getRedis();
    if (redisClient) {
      try {
        const producer = new RedisStreamProducer(redisClient);
        await producer.publish('telemetry_stream', {
          agent_id,
          cpu:            cpu            ?? '',
          memory:         memory         ?? '',
          disk:           disk           ?? '',
          health_score:   health_score   ?? '',
          network_in:     network_in     ?? 0,
          network_out:    network_out    ?? 0,
          uptime:         uptime         ?? '',
          load_avg:       load_avg       ?? '',
          log_summary:    logs           ?? '',
          process_report: process_report ?? {},
          timestamp:      now,
        });

        // Also bump last_seen (fire-and-forget; don't block response)
        if (isSupabaseReady()) {
          supabase.from('agents')
            .update({ last_seen: now })
            .eq('agent_id', agent_id)
            .then(() => {})
            .catch(err => console.error('[agents/telemetry] last_seen update error:', err.message));
        }

        return res.json({ queued: true });
      } catch (redisErr) {
        console.warn('[agents/telemetry] Redis publish failed, falling back to Supabase:', redisErr.message);
      }
    }

    // ── 2. Supabase fallback ──────────────────────────────────────────────────
    if (!isSupabaseReady()) {
      return res.json({ queued: false, warning: 'No storage backend configured' });
    }

    const row = {
      agent_id,
      cpu:            cpu            ?? null,
      memory:         memory         ?? null,
      disk:           disk           ?? null,
      health_score:   health_score   ?? null,
      network_in:     network_in     ?? 0,
      network_out:    network_out    ?? 0,
      uptime:         uptime         ?? null,
      load_avg:       load_avg       ?? null,
      log_summary:    logs           ?? null,
      process_report: process_report ?? null,
      timestamp:      now,
    };

    const [{ error: telErr }] = await Promise.all([
      supabase.from('telemetry').insert([row]),
      supabase.from('agents').update({ last_seen: now }).eq('agent_id', agent_id),
    ]);

    if (telErr) throw Object.assign(new Error(telErr.message), { status: 502 });

    res.json({ queued: false, stored: true });
  })
);

// ── GET /api/agents ───────────────────────────────────────────────────────────
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  if (!isSupabaseReady()) return res.json([]);

  const { data, error } = await supabase
    .from('agents')
    .select('*')
    .order('last_seen', { ascending: false });

  if (error) throw Object.assign(new Error(error.message), { status: 502 });

  const ONLINE_THRESHOLD_MS = 60 * 1000; // 60 seconds
  const now = Date.now();

  const agents = (data || []).map(agent => ({
    ...agent,
    online: agent.last_seen
      ? (now - new Date(agent.last_seen).getTime()) < ONLINE_THRESHOLD_MS
      : false,
  }));

  res.json(agents);
}));

// ── GET /api/agents/:id ───────────────────────────────────────────────────────
router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  if (!isSupabaseReady()) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  const agentId = req.params.id;

  // Fetch agent, last 10 telemetry rows, and open incidents in parallel
  const [agentRes, telemetryRes, incidentsRes] = await Promise.all([
    supabase
      .from('agents')
      .select('*')
      .eq('agent_id', agentId)
      .single(),
    supabase
      .from('telemetry')
      .select('*')
      .eq('agent_id', agentId)
      .order('timestamp', { ascending: false })
      .limit(10),
    supabase
      .from('incidents')
      .select('*')
      .eq('agent_id', agentId)
      .neq('status', 'resolved')
      .order('created_at', { ascending: false }),
  ]);

  if (agentRes.error || !agentRes.data) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  const ONLINE_THRESHOLD_MS = 60 * 1000;
  const agent = agentRes.data;

  res.json({
    ...agent,
    online: agent.last_seen
      ? (Date.now() - new Date(agent.last_seen).getTime()) < ONLINE_THRESHOLD_MS
      : false,
    telemetry:  telemetryRes.data  || [],
    incidents:  incidentsRes.data  || [],
  });
}));

module.exports = router;
