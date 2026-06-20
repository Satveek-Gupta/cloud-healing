'use strict';

/**
 * routes/index.js
 * Clean central router — mounts all sub-routers under /api.
 * No forwardTo hacks, no duplicate aliases.
 *
 * Route map:
 *   /api/servers/*    → routes/servers.js
 *   /api/metrics/*    → routes/metrics.js
 *   /api/commands/*   → routes/commands.js
 *   /api/agents/*     → routes/agents.js
 *   /api/history      → routes/incidents.js
 *   /api/stats        → routes/incidents.js
 *   /api/latest       → routes/incidents.js
 *
 * Agent backward-compat aliases (old paths still work):
 *   POST /api/servers/register-server  →  POST /api/servers/register
 */

const { Router }       = require('express');
const serversRouter    = require('./servers');
const metricsRouter    = require('./metrics');
const commandsRouter   = require('./commands');
const incidentsRouter  = require('./incidents');
const userRouter       = require('./user');
const agentsRouter     = require('./agents');

const router = Router();

// ── Core API ──────────────────────────────────────────────────────────────────
router.use('/servers',  serversRouter);
router.use('/metrics',  metricsRouter);
router.use('/commands', commandsRouter);
router.use('/agents',   agentsRouter);
router.use('/',         userRouter);
router.use('/',         incidentsRouter);

// ── Agent backward-compat: old registration path ──────────────────────────────
// The original agent used POST /api/servers/register-server
// We keep this alias so existing deployed agents don't break.
router.post('/servers/register-server', (req, res, next) => {
  req.url = '/register';
  serversRouter(req, res, next);
});

module.exports = router;
