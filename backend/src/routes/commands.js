'use strict';

/**
 * routes/commands.js
 * Agent command queue endpoints.
 *
 * GET    /api/commands                  → list all queued commands (admin/debug)
 * GET    /api/commands/:server_id       → agent polls for its pending command
 * POST   /api/commands/:server_id       → dashboard dispatches a command
 * POST   /api/commands/:server_id/ack   → agent acknowledges execution
 */

const { Router }       = require('express');
const commandQueue     = require('../services/commandQueue');
const { asyncHandler } = require('../middleware/errorHandler');
const { validateBody } = require('../middleware/validate');
const { ALLOWED_COMMANDS } = require('../config/constants');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const { logAuditEvent } = require('../lib/audit');

const router = Router();

// ── GET /api/commands ─────────────────────────────────────────────────────────
router.get('/', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  res.json(commandQueue.getAll());
}));

// ── GET /api/commands/:server_id ──────────────────────────────────────────────
router.get('/:server_id', asyncHandler(async (req, res) => {
  const entry = commandQueue.dequeue(req.params.server_id);
  res.json(entry ? entry : { command: null });
}));

// ── POST /api/commands/:server_id ─────────────────────────────────────────────
router.post(
  '/:server_id',
  requireAuth,
  requireAdmin,
  validateBody({ command: `string|in:${ALLOWED_COMMANDS.join(',')}` }),
  asyncHandler(async (req, res) => {
    const { command } = req.body;
    try {
      const entry = commandQueue.enqueue(req.params.server_id, command, req.user.email);
      await logAuditEvent({
        actorId: req.user.id,
        action: 'server.command.dispatch',
        metadata: { server_id: req.params.server_id, command, ip: req.ip },
      });
      res.json({ queued: true, ...entry });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  })
);

// ── POST /api/commands/:server_id/ack ─────────────────────────────────────────
router.post(
  '/:server_id/ack',
  asyncHandler(async (req, res) => {
    const { result, executed_at } = req.body || {};
    const acked = commandQueue.acknowledge(req.params.server_id, result, executed_at);
    res.json({ acknowledged: true, ...(acked || {}) });
  })
);

module.exports = router;
