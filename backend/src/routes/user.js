'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const { requireSuperAdmin } = require('../middleware/superadmin');
const { asyncHandler } = require('../middleware/errorHandler');
const { logAuditEvent } = require('../lib/audit');

const router = Router();

router.get('/user/me', requireAuth, (req, res) => {
  res.json({
    id: req.user.id,
    clerk_id: req.user.clerk_id,
    email: req.user.email,
    role: req.user.role,
  });
});

router.post('/user/session/login', requireAuth, asyncHandler(async (req, res) => {
  await logAuditEvent({
    actorId: req.user.id,
    action: 'auth.login',
    metadata: { ip: req.ip, user_agent: req.get('user-agent') || null },
  });
  res.json({ ok: true });
}));

router.post('/user/session/logout', requireAuth, asyncHandler(async (req, res) => {
  await logAuditEvent({
    actorId: req.user.id,
    action: 'auth.logout',
    metadata: { ip: req.ip, user_agent: req.get('user-agent') || null },
  });
  res.json({ ok: true });
}));

router.get('/admin/example', requireAuth, requireAdmin, (req, res) => {
  res.json({ ok: true, scope: 'ADMIN', actor: req.user.email });
});

router.post('/admin/example-action', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  await logAuditEvent({
    actorId: req.user.id,
    action: 'admin.example_action',
    metadata: { ip: req.ip },
  });
  res.json({ ok: true });
}));

router.get('/superadmin/example', requireAuth, requireSuperAdmin, (req, res) => {
  res.json({ ok: true, scope: 'SUPERADMIN', actor: req.user.email });
});

router.post('/superadmin/example-action', requireAuth, requireSuperAdmin, asyncHandler(async (req, res) => {
  await logAuditEvent({
    actorId: req.user.id,
    action: 'superadmin.example_action',
    metadata: { ip: req.ip },
  });
  res.json({ ok: true });
}));

module.exports = router;
