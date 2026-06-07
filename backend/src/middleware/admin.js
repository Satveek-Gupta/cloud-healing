'use strict';

const { ROLES } = require('../lib/roles');

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (req.user.role !== ROLES.ADMIN && req.user.role !== ROLES.SUPERADMIN) {
    return res.status(403).json({ error: 'Admin role required' });
  }
  next();
}

module.exports = { requireAdmin };
