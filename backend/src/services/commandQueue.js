'use strict';

/**
 * services/commandQueue.js
 * Pure in-memory command queue. Fully decoupled from Express.
 * One pending command per server at a time (the agent model: poll → execute → ack).
 *
 * NOTE: Commands are lost on process restart — this is intentional for simplicity.
 *       Agents re-register on boot and pick up fresh commands.
 */

const { ALLOWED_COMMANDS } = require('../config/constants');

/** @type {Map<string, object>} server_id → command entry */
const _queue = new Map();

/**
 * Add a command to the queue for a given server.
 * Overwrites any existing pending command (last write wins).
 * @throws if server_id is missing or command is not in ALLOWED_COMMANDS
 */
function enqueue(server_id, command, dispatched_by = 'dashboard') {
  if (!server_id) throw new Error('server_id is required');
  if (!ALLOWED_COMMANDS.includes(command)) {
    throw new Error(`Invalid command "${command}". Allowed: ${ALLOWED_COMMANDS.join(', ')}`);
  }

  const entry = {
    command,
    dispatched_by,
    queued_at:    new Date().toISOString(),
    status:       'pending',
  };
  _queue.set(server_id, entry);
  console.log(`[CommandQueue] Queued "${command}" for ${server_id} (by: ${dispatched_by})`);
  return entry;
}

/**
 * Fetch the pending command for a server and atomically mark it 'dispatched'.
 * Returns null if no pending command exists.
 */
function dequeue(server_id) {
  const entry = _queue.get(server_id);
  if (!entry || entry.status !== 'pending') return null;
  _queue.set(server_id, {
    ...entry,
    status:        'dispatched',
    dispatched_at: new Date().toISOString(),
  });
  // Return the original entry — agent only needs the command name
  return entry;
}

/**
 * Acknowledge a command execution from the agent.
 * Returns the updated entry or null if server had no queued command.
 */
function acknowledge(server_id, result, executed_at) {
  const entry = _queue.get(server_id);
  if (!entry) return null;
  const acked = {
    ...entry,
    status:      'acknowledged',
    result:      result      || 'success',
    executed_at: executed_at || new Date().toISOString(),
  };
  _queue.set(server_id, acked);
  console.log(`[CommandQueue] ACK from ${server_id}: ${acked.result}`);
  return acked;
}

/** Return all entries as an array (for admin/debug endpoints). */
function getAll() {
  return Array.from(_queue.entries()).map(([server_id, cmd]) => ({ server_id, ...cmd }));
}

/** Return the current entry for one server (any status), or null. */
function getForServer(server_id) {
  return _queue.get(server_id) || null;
}

module.exports = { enqueue, dequeue, acknowledge, getAll, getForServer };
