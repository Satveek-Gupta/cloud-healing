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

/** @type {Set<import('http').ServerResponse>} */
const _clients = new Set();

/**
 * Register a new SSE client (the response object from GET /api/events).
 * Sets the correct SSE headers and starts a heartbeat.
 * Returns a cleanup function to call when the connection closes.
 */
function addClient(res) {
  _clients.add(res);
  console.log(`[SSE] Client connected (active: ${_clients.size})`);
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
  for (const client of _clients) {
    try {
      client.write(msg);
    } catch {
      _clients.delete(client); // dead connection — drop it
    }
  }
}

/** Number of currently connected SSE clients. */
function clientCount() {
  return _clients.size;
}

module.exports = { addClient, removeClient, broadcast, clientCount };
