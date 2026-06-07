'use strict';

/**
 * lib/sse.js — Server-Sent Events client manager
 *
 * Maintains a set of active SSE response streams.
 * Any backend code can call broadcast() to push an event to all connected clients.
 *
 * SSE protocol:
 *   Each message is formatted as:
 *     event: <name>\n
 *     data: <JSON string>\n
 *     \n
 *
 * Free, no paid infrastructure needed. Native browser reconnect via EventSource.
 */

'use strict';

const { ROLES } = require('./roles');

/** @type {Map<import('http').ServerResponse, { user: any, channel: string, ip: string, connectedAt: number }>} */
const _clients = new Map();

const MAX_CLIENTS_PER_USER = 5;
const MAX_CLIENTS_PER_IP = 20;

function canReceive(meta, event) {
  if (!meta?.user) return false;
  if (meta.user.role === ROLES.SUPERADMIN || meta.user.role === ROLES.ADMIN) return true;

  // There is no tenant/project ownership model in the current schema yet.
  // Until that exists, USER receives read-only operational streams only.
  const readOnlyEvents = new Set([
    'connected',
    'server:updated',
    'servers:update',
    'incident:new',
    'events:update',
    'diagnosis:new',
  ]);
  return readOnlyEvents.has(event);
}

function countBy(predicate) {
  let count = 0;
  for (const meta of _clients.values()) if (predicate(meta)) count += 1;
  return count;
}

/**
 * Register a new SSE client (the response object from GET /api/events).
 * Sets the correct SSE headers and starts a heartbeat.
 * Returns a cleanup function to call when the connection closes.
 */
function addClient(res, meta) {
  const userId = meta?.user?.id;
  const ip = meta?.ip || 'unknown';
  if (userId && countBy(m => m.user?.id === userId) >= MAX_CLIENTS_PER_USER) {
    throw Object.assign(new Error('Too many SSE connections for user'), { status: 429 });
  }
  if (countBy(m => m.ip === ip) >= MAX_CLIENTS_PER_IP) {
    throw Object.assign(new Error('Too many SSE connections from IP'), { status: 429 });
  }

  _clients.set(res, {
    user: meta.user,
    channel: meta.channel || 'all',
    ip,
    connectedAt: Date.now(),
  });
  console.log(`[SSE] Client connected user=${meta.user?.email} role=${meta.user?.role} channel=${meta.channel || 'all'} active=${_clients.size}`);
}

/** Remove an SSE client (called on req 'close' event). */
function removeClient(res) {
  _clients.delete(res);
  console.log(`[SSE] Client disconnected (active: ${_clients.size})`);
}

/**
 * Broadcast an SSE event to all connected clients.
 * Silently removes broken/closed connections.
 *
 * @param {string} event  Event name (e.g. 'servers:update', 'diagnosis:new')
 * @param {any}    data   JSON-serialisable payload
 */
function broadcast(event, data) {
  if (_clients.size === 0) return;
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [client, meta] of _clients.entries()) {
    if (!canReceive(meta, event)) continue;
    try {
      client.write(msg);
    } catch {
      _clients.delete(client);
    }
  }
}

/** Number of currently connected SSE clients. */
function clientCount() {
  return _clients.size;
}

module.exports = { addClient, removeClient, broadcast, clientCount };
