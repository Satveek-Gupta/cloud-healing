'use strict';

const crypto = require('crypto');
const os     = require('os');

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

let agentToken = null; // Set after successful registration
let agentId    = null;

/**
 * Derive a stable agent ID from hostname + first non-loopback MAC address.
 * If AGENT_ID env var is set (and not 'auto'), use it directly.
 * @returns {string}
 */
function getAgentId() {
  const envId = process.env.AGENT_ID;
  if (envId && envId !== 'auto') return envId;

  const hostname = os.hostname();
  const mac = Object.values(os.networkInterfaces())
    .flat()
    .find(i => i && !i.internal && i.mac && i.mac !== '00:00:00:00:00:00')?.mac || 'unknown';

  // Create a stable, short hash
  return crypto.createHash('sha256')
    .update(`${hostname}:${mac}`)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Sign a payload with HMAC-SHA256 using the agent token.
 * @param {Object} payload
 * @param {string} token
 * @returns {string} Signature header value, e.g. "hmac-sha256=abc123..."
 */
function signPayload(payload, token) {
  const body = JSON.stringify(payload);
  const sig  = crypto.createHmac('sha256', token).update(body).digest('hex');
  return `hmac-sha256=${sig}`;
}

/**
 * Get the first non-loopback IPv4 address, fallback to 127.0.0.1.
 * @returns {string}
 */
function getLocalIp() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return '127.0.0.1';
}

/**
 * Register this agent with the backend. Sets agentToken on success.
 * Throws if the backend returns a non-OK status.
 * @returns {Promise<{ agentId: string, token: string }>}
 */
async function register() {
  agentId = agentId || getAgentId();

  const payload = {
    agent_id:         agentId,
    hostname:         os.hostname(),
    operating_system: `${os.type()} ${os.release()}`,
    ip_address:       getLocalIp(),
    environment:      process.env.ENVIRONMENT || 'production',
    version:          '1.0.0',
  };

  const r = await fetch(`${BACKEND_URL}/api/agents/register`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });

  if (!r.ok) throw new Error(`Registration failed: HTTP ${r.status}`);

  const data  = await r.json();
  agentToken  = data.token;
  return { agentId, token: agentToken };
}

/**
 * Send a heartbeat to the backend. Fails silently if not registered.
 * @returns {Promise<void>}
 */
async function heartbeat() {
  if (!agentId || !agentToken) return;

  const payload = {
    agent_id:  agentId,
    timestamp: new Date().toISOString(),
  };

  await fetch(`${BACKEND_URL}/api/agents/heartbeat`, {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'X-Agent-Signature': signPayload(payload, agentToken),
    },
    body: JSON.stringify(payload),
  }).catch(() => {}); // heartbeat failures are non-fatal
}

module.exports = {
  register,
  heartbeat,
  signPayload,
  getAgentId,
  getLocalIp,
  getToken:              () => agentToken,
  getRegisteredAgentId:  () => agentId,
};
