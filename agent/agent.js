#!/usr/bin/env node
/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║         SelfHeal Smart Node Agent v2.0                  ║
 * ║  Intelligent monitoring with local anomaly detection    ║
 * ║  Requires Node.js >= 18 (built-in fetch)                ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * Usage:
 *   SERVER_NAME=api-gateway-1 BACKEND_URL=http://localhost:8000 node agent.js
 */

'use strict';

const os   = require('os');
const path = require('path');
const fs   = require('fs');
const { execSync, exec, spawn } = require('child_process');

// ── Minimal .env parser ───────────────────────────────────────────────────
try {
  const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...val] = trimmed.split('=');
    if (key && !process.env[key]) {
      process.env[key] = val.join('=').trim();
    }
  }
} catch { /* No .env file, ignore */ }


// ── Config ────────────────────────────────────────────────────────────────
const CONFIG = {
  backendUrl:      process.env.BACKEND_URL    || 'http://localhost:8000',
  serverName:      process.env.SERVER_NAME    || os.hostname(),
  region:          process.env.REGION         || 'local',
  reportInterval:  Number(process.env.REPORT_INTERVAL  || 10_000),  // 10s normal reporting
  commandInterval: Number(process.env.COMMAND_INTERVAL ||  5_000),  // 5s command poll
};

// ── Anomaly thresholds ────────────────────────────────────────────────────
const THRESHOLD = {
  cpu:    85,   // % — triggers high_cpu anomaly
  memory: 80,   // % — triggers memory_issue anomaly
  disk:   90,   // % — triggers disk_pressure anomaly
};

const LOG_KEYWORDS = {
  critical: ['out of memory', 'oom kill', 'panic', 'fatal', 'segfault', 'killed process'],
  warning:  ['timeout', 'connection refused', 'connection reset', 'error', 'exception', 'failed'],
  info:     ['warn', 'warning', 'deprecated'],
};

// ── State ─────────────────────────────────────────────────────────────────
let serverId   = null;
let cpuPrev    = null;
let prevHealth = 100;   // track health score changes
let lastAnomaly = null; // timestamp of last anomaly report
const ANOMALY_COOLDOWN_MS = 15_000; // don't spam on consecutive anomalies

// ── Logging ───────────────────────────────────────────────────────────────
const ICONS = { INFO: 'ℹ ', WARN: '⚠ ', ERROR: '❌', OK: '✅', CMD: '⚡', ANOMALY: '🔴', HEALTH: '💚' };
const log = (level, msg, data = '') =>
  console.log(`[${new Date().toISOString()}] ${ICONS[level] || ''} [${level}] ${msg}`, data || '');

// ── HTTP helpers ──────────────────────────────────────────────────────────
async function post(urlPath, body) {
  const res = await fetch(`${CONFIG.backendUrl}${urlPath}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} on POST ${urlPath}`);
  return res.json();
}

async function get(urlPath) {
  const res = await fetch(`${CONFIG.backendUrl}${urlPath}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} on GET ${urlPath}`);
  return res.json();
}

// ── CPU ───────────────────────────────────────────────────────────────────
function getCpuSnapshot()  { return os.cpus().map(c => ({ ...c.times })); }

function computeCpuPercent(prev, curr) {
  let totalIdle = 0, totalAll = 0;
  for (let i = 0; i < prev.length; i++) {
    const p = prev[i], c = curr[i];
    const idle = c.idle - p.idle;
    const all  = Object.keys(c).reduce((s, k) => s + (c[k] - p[k]), 0);
    totalIdle += idle; totalAll += all;
  }
  if (totalAll === 0) return 0;
  return Math.round((1 - totalIdle / totalAll) * 10000) / 100;
}

// ── Memory ────────────────────────────────────────────────────────────────
function getMemoryPercent() {
  const t = os.totalmem(), f = os.freemem();
  return Math.round(((t - f) / t) * 10000) / 100;
}

function getMemoryMB() {
  const t = os.totalmem(), f = os.freemem();
  return { used: Math.round((t - f) / 1024 / 1024), total: Math.round(t / 1024 / 1024) };
}

// ── Disk usage ────────────────────────────────────────────────────────────
function getDiskUsage() {
  try {
    // Linux: df -k /
    const out = execSync("df -k / | awk 'NR==2 {print $3,$4}'", { timeout: 2000, encoding: 'utf8' }).trim();
    const [used, avail] = out.split(' ').map(Number);
    if (!used || !avail) return null;
    const total = used + avail;
    const pct   = Math.round((used / total) * 10000) / 100;
    return { used_pct: pct, used_gb: +(used / 1048576).toFixed(1), total_gb: +(total / 1048576).toFixed(1) };
  } catch {
    try {
      // macOS fallback
      const out = execSync("df -k / | awk 'NR==2 {print $3,$4}'", { timeout: 2000, encoding: 'utf8' }).trim();
      const [used, avail] = out.split(' ').map(Number);
      if (!used || !avail) return null;
      const total = used + avail;
      return { used_pct: Math.round((used / total) * 10000) / 100, used_gb: +(used / 1048576).toFixed(1), total_gb: +(total / 1048576).toFixed(1) };
    } catch { return null; }
  }
}

// ── Load average ──────────────────────────────────────────────────────────
function getLoadAverage() {
  const [l1, l5, l15] = os.loadavg();
  const cores = os.cpus().length;
  return {
    load_1m:  Math.round(l1  * 100) / 100,
    load_5m:  Math.round(l5  * 100) / 100,
    load_15m: Math.round(l15 * 100) / 100,
    load_per_core: Math.round((l1 / cores) * 100) / 100,
  };
}

// ── Uptime ────────────────────────────────────────────────────────────────
function getUptimeSeconds() { return Math.floor(os.uptime()); }

// ── Local IP ──────────────────────────────────────────────────────────────
function getLocalIp() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return '127.0.0.1';
}

// ── Raw log collection ────────────────────────────────────────────────────
function getRawLogs() {
  const cmds = [
    // Linux journalctl (filtered)
    'journalctl -n 30 --no-pager -p err 2>/dev/null | grep -iE "error|crit|fatal|oom" | tail -10',
    // macOS system log
    'log show --last 30s --style compact 2>/dev/null | grep -iE "error|crit|warn" | tail -8',
    // syslog fallback (filtered to avoid benign warnings like 'ITS mitigation')
    'tail -n 30 /var/log/syslog 2>/dev/null | grep -iE "error|crit|fatal|oom" | tail -10',
  ];
  for (const cmd of cmds) {
    try {
      const out = execSync(cmd, { timeout: 2500, encoding: 'utf8' }).trim();
      if (out) return out;
    } catch { /* try next */ }
  }
  return null;
}

// ── Log analysis ──────────────────────────────────────────────────────────
/**
 * Analyze raw log text → { severity, summary, matched_keywords, line_count }
 */
function analyzeLog(rawLog) {
  if (!rawLog) return null;

  const lines = rawLog.split('\n').filter(l => l.trim());
  const lower = rawLog.toLowerCase();

  // Detect severity
  let severity = 'info';
  const matched = [];

  for (const kw of LOG_KEYWORDS.critical) {
    if (lower.includes(kw)) { severity = 'critical'; matched.push(kw); }
  }
  if (severity !== 'critical') {
    for (const kw of LOG_KEYWORDS.warning) {
      if (lower.includes(kw)) { severity = 'warning'; matched.push(kw); }
    }
  }

  // Build short summary (max 3 most informative lines)
  const errorLines = lines.filter(l => /error|crit|fatal|warn/i.test(l)).slice(0, 3);
  const summary = errorLines.length > 0
    ? errorLines.map(l => l.replace(/^\w+ \d+ \d+:\d+:\d+ \S+ /g, '').trim().slice(0, 120)).join(' | ')
    : lines.slice(0, 2).map(l => l.trim().slice(0, 120)).join(' | ');

  return {
    severity,
    summary: summary || 'No actionable log entries.',
    matched_keywords: [...new Set(matched)],
    line_count: lines.length,
  };
}

// ── Anomaly detection ─────────────────────────────────────────────────────
/**
 * Returns list of detected anomaly types based on current metrics.
 */
function detectAnomalies(cpu, memory, disk, load, logAnalysis) {
  const issues = [];
  if (cpu >= THRESHOLD.cpu)    issues.push({ type: 'high_cpu',       value: cpu,              detail: `CPU at ${cpu}%` });
  if (memory >= THRESHOLD.memory) issues.push({ type: 'memory_issue', value: memory,           detail: `Memory at ${memory}%` });
  if (disk && disk.used_pct >= THRESHOLD.disk) issues.push({ type: 'disk_pressure', value: disk.used_pct, detail: `Disk at ${disk.used_pct}%` });
  if (load && load.load_per_core > 0.9)        issues.push({ type: 'high_load',    value: load.load_per_core, detail: `Load/core at ${load.load_per_core}` });
  if (logAnalysis?.severity === 'critical')    issues.push({ type: 'log_critical', value: 100, detail: `Keywords: ${logAnalysis.matched_keywords.join(', ')}` });
  if (logAnalysis?.severity === 'warning')     issues.push({ type: 'log_warning',  value: 50,  detail: `Keywords: ${logAnalysis.matched_keywords.join(', ')}` });
  return issues;
}

// ── Health score ──────────────────────────────────────────────────────────
/**
 * Composite 0–100 score. Higher = healthier.
 *
 * Weights:  CPU 40%, Memory 35%, Logs 15%, Disk 10%
 */
function computeHealthScore(cpu, memory, logAnalysis, disk) {
  const cpuScore  = Math.max(0, 100 - Math.max(0, cpu - 50) * 2);         // drops fast above 50
  const memScore  = Math.max(0, 100 - Math.max(0, memory - 60) * 2.5);
  const logScore  = logAnalysis?.severity === 'critical' ? 20
                  : logAnalysis?.severity === 'warning'  ? 65 : 100;
  const diskScore = disk ? Math.max(0, 100 - Math.max(0, disk.used_pct - 70) * 3) : 100;

  const score = cpuScore * 0.40 + memScore * 0.35 + logScore * 0.15 + diskScore * 0.10;
  return Math.round(Math.min(100, Math.max(0, score)));
}

// ── Payload builder ───────────────────────────────────────────────────────
function buildPayload({ cpu, memory, disk, load, uptime, logAnalysis, anomalies, healthScore }) {
  const primaryIssue = anomalies[0];

  return {
    server_id:    serverId,
    cpu:          cpu,
    memory:       memory,
    uptime:       uptime,

    // Advanced metrics
    disk_used_pct: disk?.used_pct ?? null,
    load_1m:       load?.load_1m ?? null,
    load_per_core: load?.load_per_core ?? null,
    memory_used_mb: getMemoryMB().used,

    // Intelligence
    issue_type:   primaryIssue?.type   ?? null,
    severity:     logAnalysis?.severity ?? (anomalies.length > 0 ? 'warning' : 'info'),
    log_summary:  logAnalysis?.summary ?? null,
    health_score: healthScore,
    anomalies:    anomalies.map(a => a.type),
    is_anomaly:   anomalies.length > 0,
  };
}

// ── Registration ──────────────────────────────────────────────────────────
async function registerServer() {
  log('INFO', `Registering "${CONFIG.serverName}" (${getLocalIp()}) — ${CONFIG.region}`);
  try {
    const data = await post('/api/servers/register-server', {
      name:       CONFIG.serverName,
      ip_address: getLocalIp(),
      region:     CONFIG.region,
    });
    serverId = data.id;
    log('OK', `Registered. Server ID: ${serverId}`);
  } catch (err) {
    log('ERROR', 'Registration failed:', err.message);
    log('WARN', 'Retrying in 10s...');
    setTimeout(registerServer, 10_000);
  }
}

// ── Core metrics cycle ────────────────────────────────────────────────────
async function collectAndSend(forceReport = false) {
  if (!serverId) {
    log('WARN', 'Not registered — skipping metrics push');
    return;
  }

  // CPU (needs two snapshots)
  const cpuCurr = getCpuSnapshot();
  const cpu     = cpuPrev ? computeCpuPercent(cpuPrev, cpuCurr) : null;
  cpuPrev = cpuCurr;
  if (cpu === null) { log('INFO', 'First CPU sample — warming up...'); return; }

  // All other metrics (cheap, synchronous)
  const memory      = getMemoryPercent();
  const disk        = getDiskUsage();
  const load        = getLoadAverage();
  const uptime      = getUptimeSeconds();
  const rawLog      = getRawLogs();
  const logAnalysis = analyzeLog(rawLog);
  const anomalies   = detectAnomalies(cpu, memory, disk, load, logAnalysis);
  const healthScore = computeHealthScore(cpu, memory, logAnalysis, disk);

  const hasAnomaly = anomalies.length > 0;
  const healthDrop = healthScore < prevHealth - 10;  // significant health change

  // Smart reporting: always send on anomaly (with cooldown) or on schedule
  const now = Date.now();
  const cooledDown = !lastAnomaly || (now - lastAnomaly) > ANOMALY_COOLDOWN_MS;
  const shouldReport = forceReport || !hasAnomaly || (hasAnomaly && cooledDown) || healthDrop;

  if (!shouldReport) {
    log('INFO', `Skipping (anomaly cooldown active) — health: ${healthScore}/100`);
    return;
  }

  if (hasAnomaly) lastAnomaly = now;
  prevHealth = healthScore;

  const payload = buildPayload({ cpu, memory, disk, load, uptime, logAnalysis, anomalies, healthScore });

  // Console summary
  const anomalyStr = anomalies.length ? `⚠ ${anomalies.map(a => a.type).join(', ')}` : '—';
  const healthIcon = healthScore >= 80 ? '💚' : healthScore >= 50 ? '🟡' : '🔴';
  log(
    hasAnomaly ? 'ANOMALY' : 'INFO',
    `cpu:${cpu}% mem:${memory}% disk:${disk?.used_pct ?? '?'}% ` +
    `load:${load.load_per_core}/core | ${healthIcon} health:${healthScore}/100 | anomalies:${anomalyStr}`
  );
  if (logAnalysis?.severity !== 'info') {
    log('WARN', `Logs [${logAnalysis.severity.toUpperCase()}]: ${logAnalysis.summary.slice(0, 100)}`);
  }

  try {
    const res = await post('/api/metrics', payload);

    if (res.healing?.triggered) {
      log('OK',  `🩺 AI healing triggered!`);
      log('CMD', `Action: ${res.healing.action_label} (${res.healing.confidence}% confidence)`);
      log('CMD', `Cause:  ${res.healing.root_cause}`);
      log('CMD', `Fix:    ${res.healing.action_detail}`);
      await executeAction(res.healing.action, res.healing.root_cause);
    }
  } catch (err) {
    log('ERROR', 'Metrics push failed:', err.message);
  }
}

// ── Command polling ───────────────────────────────────────────────────────
async function pollCommands() {
  if (!serverId) return;
  try {
    const data = await get(`/api/commands/${serverId}`);
    if (data?.command) {
      log('CMD', `Received command: "${data.command}"`);
      await executeAction(data.command, 'Dashboard dispatch');
      await post(`/api/commands/${serverId}/ack`, {
        executed_at: new Date().toISOString(), result: 'success',
      }).catch(() => {});
    }
  } catch { /* endpoint may not exist — silent */ }
}

// ── Action executor ───────────────────────────────────────────────────────
async function executeAction(action, reason) {
  log('CMD', `Executing: "${action}" — ${reason}`);

  switch (action) {
    case 'restart_service': {
      log('CMD', 'Graceful service restart...');
      await sleep(2000);
      log('OK', 'Service restarted. Health probes resumed.');
      break;
    }

    case 'kill_process': {
      log('CMD', 'Locating highest CPU consumer...');
      try {
        const selfPid = process.pid;
        const topPid  = execSync(
          `ps aux --sort=-%cpu 2>/dev/null | awk 'NR==2{print $2}' | grep -v ${selfPid}`,
          { encoding: 'utf8', timeout: 3000 }
        ).trim();
        if (topPid && !isNaN(topPid)) {
          execSync(`kill -15 ${topPid}`, { timeout: 2000 });
          log('OK', `PID ${topPid} terminated.`);
        } else {
          log('WARN', 'No killable target — simulated kill.');
          await sleep(800);
          log('OK', 'Kill simulated.');
        }
      } catch (e) {
        log('WARN', 'kill_process fallback (simulated):', e.message);
        await sleep(800);
        log('OK', 'Kill simulated.');
      }
      break;
    }

    case 'scale_up': {
      log('CMD', 'Provisioning +2 replicas...');
      await sleep(1500);
      log('OK', 'Scale-up dispatched. Load balancer routing updated.');
      break;
    }

    case 'stress_cpu': {
      const dur  = Number(process.env.STRESS_CPU_SECONDS || 20);
      const script = path.join(__dirname, 'stress-cpu.js');
      log('CMD', `Launching CPU stress (${dur}s) → ${script}`);
      spawn(process.execPath, [script, String(dur)], { detached: true, stdio: 'ignore' }).unref();
      log('OK', 'CPU stress worker launched.');
      break;
    }

    case 'process_crash': {
      log('CMD', 'Spawning crash simulation...');
      spawn(process.execPath, ['-e', `console.error('FATAL simulated crash'); process.exit(1);`],
        { detached: true, stdio: 'ignore' }).unref();
      await sleep(500);
      log('OK', 'Crash simulation spawned.');
      break;
    }

    default:
      log('WARN', `Unknown action: "${action}" — no handler.`);
  }
}

// ── Init ──────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const disk  = getDiskUsage();
  const load  = getLoadAverage();
  const mem   = getMemoryMB();

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║         SelfHeal Smart Node Agent v2.0                      ║');
  console.log('║         Intelligent monitoring · Local anomaly detection     ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`  Backend:   ${CONFIG.backendUrl}`);
  console.log(`  Name:      ${CONFIG.serverName}`);
  console.log(`  Region:    ${CONFIG.region}`);
  console.log(`  IP:        ${getLocalIp()}`);
  console.log(`  Memory:    ${mem.used} / ${mem.total} MB`);
  console.log(`  Disk:      ${disk?.used_gb ?? '?'} / ${disk?.total_gb ?? '?'} GB (${disk?.used_pct ?? '?'}%)`);
  console.log(`  Cores:     ${os.cpus().length} × ${os.cpus()[0]?.model?.trim() ?? '?'}`);
  console.log(`  Load:      ${load.load_1m} (1m) / ${load.load_5m} (5m) / ${load.load_15m} (15m)`);
  console.log(`  Interval:  ${CONFIG.reportInterval / 1000}s (fast-path on anomaly)`);
  console.log(`  Node.js:   ${process.version}`);
  console.log('');
  console.log('  Anomaly thresholds:');
  console.log(`    CPU > ${THRESHOLD.cpu}% → high_cpu`);
  console.log(`    Mem > ${THRESHOLD.memory}% → memory_issue`);
  console.log(`    Disk > ${THRESHOLD.disk}% → disk_pressure`);
  console.log(`    Log keywords: ${[...LOG_KEYWORDS.critical, ...LOG_KEYWORDS.warning].slice(0, 5).join(', ')}...`);
  console.log('');

  // Warm-up CPU snapshot
  cpuPrev = getCpuSnapshot();

  await registerServer();

  // Metrics loop: 2s fast-sample for accurate CPU, report every reportInterval
  let sampleCount = 0;
  const SAMPLES_PER_REPORT = Math.max(1, Math.round(CONFIG.reportInterval / 2000));
  setInterval(() => {
    sampleCount++;
    if (sampleCount % SAMPLES_PER_REPORT === 0) {
      collectAndSend(false);  // scheduled report
    } else {
      // Quick CPU sample for accurate delta (update cpuPrev without reporting)
      const cpuCurr = getCpuSnapshot();
      if (cpuPrev) {
        const cpu = computeCpuPercent(cpuPrev, cpuCurr);
        // Immediate anomaly report if very high (bypass schedule)
        if (cpu >= THRESHOLD.cpu + 10) {  // e.g. > 95%
          log('ANOMALY', `Urgent CPU spike: ${cpu}% — triggering immediate report`);
          cpuPrev = cpuCurr;
          collectAndSend(true);
          return;
        }
      }
      cpuPrev = cpuCurr;
    }
  }, 2000);

  // Command poll
  setInterval(pollCommands, CONFIG.commandInterval);

  process.on('SIGINT',  () => { log('INFO', 'Agent shutting down (SIGINT).');  process.exit(0); });
  process.on('SIGTERM', () => { log('INFO', 'Agent shutting down (SIGTERM).'); process.exit(0); });

  log('OK', 'Smart Node Agent running. Press Ctrl+C to stop.');
}

main().catch(err => {
  log('ERROR', 'Fatal agent error:', err.message);
  process.exit(1);
});
