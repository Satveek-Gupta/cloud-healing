'use strict';

/**
 * lib/ws.js — Real-time broadcast hub (SSE-backed)
 *
 * This module keeps the same API that all call sites use
 * (broadcast, broadcastServers, broadcastEvents) but now
 * pushes events via Server-Sent Events instead of a custom WS server.
 *
 * No paid infrastructure required. Browsers reconnect automatically.
 */

const sse                           = require('./sse');
const { supabase, isSupabaseReady } = require('./supabase');
const { applyOnlineStatus }         = require('../services/serverStatus');

// ── Data fetcher ─────────────────────────────────────────────────────────────
async function fetchServers() {
  if (!isSupabaseReady()) return [];
  const { data } = await supabase
    .from('servers').select('*').order('last_seen', { ascending: false });
  return (data || []).map(applyOnlineStatus);
}

// ── Public API (same interface as before) ─────────────────────────────────────

/**
 * Broadcast any SSE event to all connected frontend clients.
 * @param {string} event  e.g. 'diagnosis:new', 'server:updated'
 * @param {any}    data   JSON-serialisable payload
 */
function broadcast(event, data) {
  sse.broadcast(event, data);
}

/**
 * Fetch the current server list from Supabase and push it to all clients.
 * Used by the healing pipeline where we need the freshest data.
 * For heartbeat updates, use broadcast('server:updated', row) instead.
 */
async function broadcastServers() {
  if (sse.clientCount() === 0) return; // no-op if nobody is listening
  try {
    const servers = await fetchServers();
    sse.broadcast('servers:update', servers);
  } catch (_) {}
}

/**
 * Fetch the current incident list and push it to all clients.
 */
async function broadcastEvents() {
  if (sse.clientCount() === 0 || !isSupabaseReady()) return;
  try {
    const { data } = await supabase
      .from('incidents').select('*').order('timestamp', { ascending: false }).limit(50);
    sse.broadcast('events:update', data || []);
  } catch (_) {}
}

module.exports = { broadcast, broadcastServers, broadcastEvents };
