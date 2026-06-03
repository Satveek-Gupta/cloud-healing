'use strict';

/**
 * services/scraper.js
 * Node Exporter scraper — pulls metrics from every registered server.
 *
 * Flow (every SCRAPE_INTERVAL_MS):
 *  1. Fetch server list from Supabase
 *  2. Hit each server's :9100/metrics endpoint in parallel
 *  3. Parse Prometheus text format
 *  4. Compute CPU%, memory%, disk%, load, uptime
 *  5. Persist metric row + update server row
 *  6. Run healing pipeline if CPU is critical
 *  7. Broadcast updated server row via SSE
 *
 * CPU note:
 *   node_cpu_seconds_total is a monotonic counter. We must store the
 *   previous sample and compute the delta between two scrapes.
 *   The first scrape per server will have cpu=null — this is expected.
 */

const { supabase, isSupabaseReady }  = require('../lib/supabase');
const { parse, getValue, getEntries } = require('./prometheusParser');
const { broadcast }                   = require('../lib/ws');
const { runHealingPipeline }          = require('./healingPipeline');
const { applyOnlineStatus }           = require('./serverStatus');
const {
  CPU_CRITICAL,
  SCRAPE_INTERVAL_MS,
  SCRAPE_TIMEOUT_MS,
  DEFAULT_EXPORTER_PORT,
} = require('../config/constants');

// ── In-memory CPU delta store ─────────────────────────────────────────────────
// CPU is a counter — we need two samples to compute usage %.
// Map<serverId, { idle: number, total: number }>
const _prevCpu = new Map();

let _timer   = null;
let _running = false;

// ── Metric computation ────────────────────────────────────────────────────────

/** Format uptime seconds → "2d 3h" / "5h 10m" / "4m" */
function fmtUptime(s) {
  if (s == null) return null;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Format number → "34.52%" string for storage */
const fmtPct = v => v != null ? `${Number(v).toFixed(2)}%` : null;

/**
 * Extract and compute human-readable metrics from parsed Prometheus data.
 * Returns null values for metrics we can't yet compute (e.g. CPU on first scrape).
 */
function computeMetrics(serverId, metrics) {
  // ── Memory (gauge — straightforward) ──────────────────────────────────────
  const memTotal = getValue(metrics, 'node_memory_MemTotal_bytes');
  const memAvail = getValue(metrics, 'node_memory_MemAvailable_bytes');
  const memory   = (memTotal && memAvail != null)
    ? Number(((1 - memAvail / memTotal) * 100).toFixed(2))
    : null;

  // ── CPU (counter — requires delta between two scrapes) ────────────────────
  const cpuEntries = getEntries(metrics, 'node_cpu_seconds_total');
  let cpu = null;

  if (cpuEntries.length > 0) {
    let idleSum = 0, totalSum = 0;
    for (const { labels, value } of cpuEntries) {
      totalSum += value;
      if (labels.mode === 'idle') idleSum += value;
    }

    const prev = _prevCpu.get(serverId);
    if (prev) {
      const idleDelta  = idleSum  - prev.idle;
      const totalDelta = totalSum - prev.total;
      if (totalDelta > 0) {
        cpu = Number(Math.max(0, (1 - idleDelta / totalDelta) * 100).toFixed(2));
      }
    }
    // Always store this sample for the next cycle
    _prevCpu.set(serverId, { idle: idleSum, total: totalSum });
  }

  // ── Disk (find root filesystem entry) ─────────────────────────────────────
  const fsRoot  = getEntries(metrics, 'node_filesystem_size_bytes')
    .find(e => e.labels.mountpoint === '/');
  const fsAvail = getEntries(metrics, 'node_filesystem_avail_bytes')
    .find(e => e.labels.mountpoint === '/');
  const disk_used_pct = (fsRoot?.value && fsAvail?.value != null)
    ? Number(((1 - fsAvail.value / fsRoot.value) * 100).toFixed(2))
    : null;

  // ── Load average (gauge) ──────────────────────────────────────────────────
  const load_1m = getValue(metrics, 'node_load1');

  // ── Uptime (derived from boot time) ──────────────────────────────────────
  const bootTime      = getValue(metrics, 'node_boot_time_seconds');
  const uptimeSeconds = bootTime ? Math.floor(Date.now() / 1000 - bootTime) : null;

  return { cpu, memory, disk_used_pct, load_1m, uptime: uptimeSeconds };
}

// ── Per-server scrape ─────────────────────────────────────────────────────────

async function scrapeServer(server) {
  const port = server.exporter_port || DEFAULT_EXPORTER_PORT;
  const url  = `http://${server.ip_address}:${port}/metrics`;

  // ── Fetch /metrics ────────────────────────────────────────────────────────
  let rawText;
  try {
    const ctrl    = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), SCRAPE_TIMEOUT_MS);
    const res     = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    rawText = await res.text();
  } catch (err) {
    console.warn(`[Scraper] ✗ ${server.name} (${url}): ${err.message}`);
    // Mark offline in DB + broadcast
    if (isSupabaseReady()) {
      await supabase.from('servers')
        .update({ status: 'offline', last_seen: new Date().toISOString() })
        .eq('id', server.id)
        .then(({ error }) => { if (error) console.warn('[Scraper] offline update failed:', error.message); });
    }
    broadcast('server:updated', applyOnlineStatus({ ...server, status: 'offline' }));
    return;
  }

  // ── Parse + compute ───────────────────────────────────────────────────────
  const metrics  = parse(rawText);
  const computed = computeMetrics(server.id, metrics);
  const { cpu, memory, disk_used_pct, load_1m, uptime } = computed;

  const cpuNum   = cpu    ?? 0;
  const memNum   = memory ?? 0;
  const timestamp = new Date().toISOString();
  const isCritical = cpuNum > CPU_CRITICAL;
  const status     = isCritical ? 'critical' : 'healthy';

  // ── Persist metric snapshot ───────────────────────────────────────────────
  if (isSupabaseReady()) {
    supabase.from('metrics')
      .insert([{ server_id: server.id, cpu: cpuNum || null, memory: memNum || null, uptime, timestamp }])
      .then(({ error }) => { if (error) console.warn('[Scraper] metrics insert failed:', error.message); });
    // ↑ fire-and-forget — don't await, don't block SSE broadcast
  }

  // ── Update server row ─────────────────────────────────────────────────────
  const serverPatch = {
    status,
    last_seen: timestamp,
    ...(cpu           != null && { cpu:          fmtPct(cpu)      }),
    ...(memory        != null && { memory:       fmtPct(memory)   }),
    ...(uptime        != null && { uptime:       fmtUptime(uptime) }),
    ...(disk_used_pct != null && { disk_used_pct                   }),
    ...(load_1m       != null && { load_1m:      Number(load_1m.toFixed(3)) }),
  };

  if (isSupabaseReady()) {
    supabase.from('servers').update(serverPatch).eq('id', server.id)
      .then(({ error }) => { if (error) console.warn('[Scraper] server update failed:', error.message); });
    // ↑ fire-and-forget
  }

  const updatedServer = applyOnlineStatus({ ...server, ...serverPatch });

  // ── Healthy: broadcast + done ─────────────────────────────────────────────
  if (!isCritical) {
    console.log(`[Scraper] ${server.name} cpu=${cpuNum.toFixed(1)}% mem=${memNum.toFixed(1)}%` +
      (disk_used_pct != null ? ` disk=${disk_used_pct.toFixed(1)}%` : ''));
    broadcast('server:updated', updatedServer);
    return;
  }

  // ── Critical: run healing pipeline ───────────────────────────────────────
  console.log(`[Scraper] ⚠️  CRITICAL ${server.name} cpu=${cpuNum.toFixed(1)}% — healing pipeline starting`);
  try {
    await runHealingPipeline({ server_id: server.id, serverName: server.name, cpuNum, memNum, logText: null, timestamp });
  } catch (err) {
    console.error(`[Scraper] Healing pipeline error (${server.name}):`, err.message);
    broadcast('server:updated', { ...updatedServer, status: 'critical' });
  }
}

// ── Scrape cycle ──────────────────────────────────────────────────────────────

async function runScrapeCycle() {
  if (!isSupabaseReady()) return;
  if (_running) {
    console.warn('[Scraper] Previous cycle still running — skipping this tick');
    return;
  }
  _running = true;
  try {
    const { data: servers, error } = await supabase
      .from('servers')
      .select('id, name, ip_address, exporter_port, status')
      .order('name');

    if (error) { console.warn('[Scraper] Server list fetch failed:', error.message); return; }
    if (!servers?.length) return;

    // All servers scraped concurrently — allSettled so one failure doesn't kill others
    await Promise.allSettled(servers.map(s => scrapeServer(s)));
  } finally {
    _running = false;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

function startScraper() {
  if (_timer) return;
  console.log(`[Scraper] ✅ Started — scraping every ${SCRAPE_INTERVAL_MS / 1000}s, timeout ${SCRAPE_TIMEOUT_MS / 1000}s`);
  // First cycle after 5s (let the server fully boot + Supabase client init)
  setTimeout(runScrapeCycle, 5_000);
  _timer = setInterval(runScrapeCycle, SCRAPE_INTERVAL_MS);
}

function stopScraper() {
  if (_timer) { clearInterval(_timer); _timer = null; }
  console.log('[Scraper] Stopped.');
}

module.exports = { startScraper, stopScraper };
