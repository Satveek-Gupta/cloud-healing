'use strict';

/**
 * services/serverStatus.js
 * Single source of truth for the online/offline staleness check.
 * Import this everywhere — never re-implement the STALE_THRESHOLD check.
 */

const { STALE_THRESHOLD_MS } = require('../config/constants');

/**
 * Returns the server object with its `status` overridden to 'offline'
 * if it hasn't sent a heartbeat within STALE_THRESHOLD_MS — UNLESS
 * it is already in 'critical' state (keep that visible).
 *
 * @param {object} server  A server row from Supabase
 * @returns {object}       The same server object, possibly with status: 'offline'
 */
function applyOnlineStatus(server) {
  if (!server || !server.last_seen) return server;
  const age = Date.now() - new Date(server.last_seen).getTime();
  if (age > STALE_THRESHOLD_MS && server.status !== 'critical') {
    return { ...server, status: 'offline' };
  }
  return server;
}

module.exports = { applyOnlineStatus };
