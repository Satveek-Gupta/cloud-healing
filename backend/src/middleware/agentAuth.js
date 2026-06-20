'use strict';
/**
 * middleware/agentAuth.js
 * Verifies HMAC-SHA256 signature on agent requests.
 * Header: X-Agent-Signature: hmac-sha256=<hex>
 */
const crypto = require('crypto');
const { supabase, isSupabaseReady } = require('../lib/supabase');

async function verifyAgentSignature(req, res, next) {
  const sig = req.headers['x-agent-signature'];
  if (!sig) return res.status(401).json({ error: 'Missing X-Agent-Signature header' });

  const agentId = req.body?.agent_id;
  if (!agentId) return res.status(400).json({ error: 'Missing agent_id in body' });

  if (!isSupabaseReady()) return next(); // dev mode: skip verification

  // Fetch agent token from DB
  const { data, error } = await supabase
    .from('agents')
    .select('token')
    .eq('agent_id', agentId)
    .single();

  if (error || !data) return res.status(401).json({ error: 'Unknown agent' });

  const expected = 'hmac-sha256=' + crypto
    .createHmac('sha256', data.token)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  req.agentToken = data.token;
  next();
}

module.exports = { verifyAgentSignature };
