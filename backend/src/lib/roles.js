'use strict';

const config = require('../config/env');

const ROLES = Object.freeze({
  SUPERADMIN: 'SUPERADMIN',
  ADMIN: 'ADMIN',
  USER: 'USER',
});

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function roleForEmail(email) {
  const e = normalizeEmail(email);
  if (config.superadminEmail && e === config.superadminEmail) return ROLES.SUPERADMIN;
  if (config.adminEmail && e === config.adminEmail) return ROLES.ADMIN;
  return ROLES.USER;
}

function isAdminRole(role) {
  return role === ROLES.ADMIN || role === ROLES.SUPERADMIN;
}

module.exports = { ROLES, normalizeEmail, roleForEmail, isAdminRole };
