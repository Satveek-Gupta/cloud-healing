'use strict';

/**
 * routes/servers.js
 * CRUD for registered monitoring nodes.
 *
 * GET    /api/servers            → list all nodes with live online/offline status
 * GET    /api/servers/:id        → single node detail
 * POST   /api/servers/register   → register or re-register a node (upsert by name)
 * DELETE /api/servers/:id        → deregister a node
 */

const { Router }           = require('express');
const { supabase, isSupabaseReady } = require('../lib/supabase');
const { applyOnlineStatus }= require('../services/serverStatus');
const { broadcastServers } = require('../lib/ws');
const { asyncHandler }     = require('../middleware/errorHandler');
const { validateBody }     = require('../middleware/validate');
const { requireAuth }      = require('../middleware/auth');
const { requireAdmin }      = require('../middleware/admin');
const { requireSuperAdmin } = require('../middleware/superadmin');
const { logAuditEvent }    = require('../lib/audit');

const router = Router();

// ── GET /api/servers ──────────────────────────────────────────────────────────
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  if (!isSupabaseReady()) {
    return res.json([]);
  }
  const { data, error } = await supabase
    .from('servers').select('*').order('last_seen', { ascending: false });
  if (error) throw Object.assign(new Error(error.message), { status: 502 });
  res.json((data || []).map(applyOnlineStatus));
}));

// ── GET /api/servers/:id ──────────────────────────────────────────────────────
router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  if (!isSupabaseReady()) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  const { data, error } = await supabase
    .from('servers').select('*').eq('id', req.params.id).single();
  if (error || !data) return res.status(404).json({ error: 'Server not found' });
  res.json(applyOnlineStatus(data));
}));

// ── POST /api/servers/register ────────────────────────────────────────────────
// Restricted to SUPERADMIN — only the owner can add new monitored nodes.
router.post(
  '/register',
  requireAuth,
  requireSuperAdmin,
  validateBody({ name: 'string', ip_address: 'string', region: 'string?', exporter_port: 'number?' }),
  asyncHandler(async (req, res) => {
    const { name, ip_address, region, exporter_port } = req.body;
    const port = Number(exporter_port) || 9100;
    const now  = new Date().toISOString();

    if (!isSupabaseReady()) {
      return res.status(201).json({
        id: `mock-${Date.now()}`, name, ip_address,
        region: region || 'unknown', exporter_port: port,
        status: 'healthy', last_seen: now,
        cpu: '0%', memory: '0%', uptime: '—',
      });
    }

    const { data: existing } = await supabase
      .from('servers').select('id').eq('name', name).maybeSingle();

    if (existing?.id) {
      const { data: updated, error } = await supabase
        .from('servers')
        .update({ ip_address, region: region || 'unknown', exporter_port: port, status: 'healthy', last_seen: now })
        .eq('id', existing.id)
        .select().single();
      if (error) throw Object.assign(new Error(error.message), { status: 502 });
      await logAuditEvent({
        actorId: req.user.id,
        action: 'server.register',
        metadata: { server_id: existing.id, name, ip_address, region: region || 'unknown', re_registered: true, ip: req.ip },
      });
      broadcastServers();
      return res.status(200).json(updated);
    }

    const { data, error } = await supabase
      .from('servers')
      .insert([{ name, ip_address, region: region || 'unknown', exporter_port: port, status: 'healthy', last_seen: now, cpu: '0%', memory: '0%', uptime: '—' }])
      .select();
    if (error) throw Object.assign(new Error(error.message), { status: 502 });
    await logAuditEvent({
      actorId: req.user.id,
      action: 'server.register',
      metadata: { server_id: data[0]?.id, name, ip_address, region: region || 'unknown', re_registered: false, ip: req.ip },
    });
    broadcastServers();
    res.status(201).json(data[0]);
  })
);


// ── DELETE /api/servers/:id ───────────────────────────────────────────────────
router.delete('/:id', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  if (!isSupabaseReady()) {
    return res.json({ removed: true, id: req.params.id });
  }
  const { error } = await supabase.from('servers').delete().eq('id', req.params.id);
  if (error) throw Object.assign(new Error(error.message), { status: 502 });
  await logAuditEvent({
    actorId: req.user.id,
    action: 'server.delete',
    metadata: { server_id: req.params.id, ip: req.ip },
  });
  broadcastServers();
  res.json({ removed: true, id: req.params.id });
}));

module.exports = router;
