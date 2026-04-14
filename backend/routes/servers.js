const { Router } = require('express');
const { supabase, isSupabaseReady } = require('../lib/supabase');
const { broadcastServers } = require('../lib/ws');

const router = Router();

// A server is considered OFFLINE if it hasn't sent metrics in this many ms
const STALE_THRESHOLD_MS = 60_000; // 60 seconds — gives 10s-interval agents 5 missed beats before offline

function applyOnlineStatus(server) {
  const lastSeen = new Date(server.last_seen).getTime();
  const age = Date.now() - lastSeen;
  if (age > STALE_THRESHOLD_MS && server.status !== 'critical') {
    return { ...server, status: 'offline' };
  }
  return server;
}

// In-memory fallback store — pre-seeded with realistic demo nodes
let mockServers = [
  { id: 'srv-001', name: 'api-gateway-prod', ip_address: '10.0.1.12', status: 'healthy', last_seen: new Date().toISOString(), region: 'us-east-1',    cpu: '34%', memory: '61%', uptime: '99.97%' },
  { id: 'srv-002', name: 'db-primary',        ip_address: '10.0.2.5',  status: 'healthy', last_seen: new Date().toISOString(), region: 'us-east-1',    cpu: '18%', memory: '72%', uptime: '99.99%' },
  { id: 'srv-003', name: 'worker-eu-1',       ip_address: '10.1.0.8',  status: 'healthy', last_seen: new Date().toISOString(), region: 'eu-central-1', cpu: '41%', memory: '55%', uptime: '99.95%' },
  { id: 'srv-004', name: 'cache-layer-ap',    ip_address: '10.2.0.22', status: 'healthy', last_seen: new Date().toISOString(), region: 'ap-south-1',   cpu: '26%', memory: '48%', uptime: '99.91%' },
  { id: 'srv-005', name: 'cdn-edge-west',     ip_address: '10.0.3.99', status: 'healthy', last_seen: new Date().toISOString(), region: 'us-west-2',    cpu: '12%', memory: '30%', uptime: '100%'   },
];

// GET /api/servers — List all registered nodes with live online/offline status
router.get('/', async (req, res) => {
  if (isSupabaseReady()) {
    const { data, error } = await supabase
      .from('servers')
      .select('*')
      .order('last_seen', { ascending: false });
    return res.json(error ? [] : (data || []).map(applyOnlineStatus));
  }
  mockServers = mockServers.map(s => ({ ...s, last_seen: new Date().toISOString() }));
  res.json(mockServers.map(applyOnlineStatus));
});

// GET /api/servers/:id — Get a single server's full detail
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  if (isSupabaseReady()) {
    const { data, error } = await supabase.from('servers').select('*').eq('id', id).single();
    if (error || !data) return res.status(404).json({ error: 'Server not found' });
    return res.json(applyOnlineStatus(data));
  }
  const server = mockServers.find(s => s.id === id);
  if (!server) return res.status(404).json({ error: 'Server not found' });
  res.json(applyOnlineStatus(server));
});

// POST /api/servers/register-server — Register or re-register a node (upsert by name)
router.post('/register-server', async (req, res) => {
  const { name, ip_address, region } = req.body;
  if (!name || !ip_address) {
    return res.status(400).json({ error: 'name and ip_address are required' });
  }

  const now = new Date().toISOString();

  if (isSupabaseReady()) {
    // Check if a server with this name already exists → reuse it
    const { data: existing } = await supabase
      .from('servers')
      .select('id')
      .eq('name', name)
      .maybeSingle();

    if (existing?.id) {
      // Update the existing record (new IP, region, mark online)
      const { data: updated, error } = await supabase
        .from('servers')
        .update({ ip_address, region: region || 'unknown', status: 'healthy', last_seen: now })
        .eq('id', existing.id)
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      broadcastServers();
      return res.status(200).json(updated);
    }

    // New server — insert
    const { data, error } = await supabase
      .from('servers')
      .insert([{ name, ip_address, region: region || 'unknown', status: 'healthy', last_seen: now, cpu: '0%', memory: '0%', uptime: '100%' }])
      .select();
    if (error) return res.status(500).json({ error: error.message });
    broadcastServers();
    return res.status(201).json(data[0]);
  }

  // In-memory fallback (no Supabase)
  const existing = mockServers.find(s => s.name === name);
  if (existing) {
    existing.ip_address = ip_address;
    existing.region = region || 'unknown';
    existing.status = 'healthy';
    existing.last_seen = now;
    broadcastServers();
    return res.status(200).json(existing);
  }
  const mockEntry = { id: `srv-${Date.now()}`, name, ip_address, region: region || 'unknown', status: 'healthy', last_seen: now, cpu: '0%', memory: '0%', uptime: '100%' };
  mockServers.unshift(mockEntry);
  broadcastServers();
  res.status(201).json(mockEntry);
});

// DELETE /api/servers/:id — Deregister / remove a node
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  if (isSupabaseReady()) {
    const { error } = await supabase.from('servers').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    broadcastServers();
    return res.json({ removed: true, id });
  }
  mockServers = mockServers.filter(s => s.id !== id);
  broadcastServers();
  res.json({ removed: true, id });
});

module.exports = router;
