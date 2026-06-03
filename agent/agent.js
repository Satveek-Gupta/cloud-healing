#!/usr/bin/env node
/**
 * SelfHeal Lightweight Agent v3.0
 *
 * Does exactly two things:
 *   1. Poll backend for healing commands → execute them locally
 *   2. Tail system logs → push alerts on critical/warning keywords
 *
 * Metrics collection is handled by Node Exporter — not this agent.
 *
 * Usage:
 *   SERVER_NAME=api-1 BACKEND_URL=http://your-backend:5000 node agent.js
 */

'use strict';

const os   = require('os');
const fs   = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

// ── .env loader ───────────────────────────────────────────────────────────
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const [k, ...v] = t.split('=');
    if (k && !process.env[k]) process.env[k] = v.join('=').trim();
  }
} catch { /* no .env — that's fine */ }

// ── Config ────────────────────────────────────────────────────────────────
const BACKEND    = process.env.BACKEND_URL      || 'http://localhost:5000';
const NAME       = process.env.SERVER_NAME      || os.hostname();
const REGION     = process.env.REGION           || 'local';
const CMD_POLL   = Number(process.env.CMD_POLL_MS  || 5_000);   // how often to poll for commands
const LOG_POLL   = Number(process.env.LOG_POLL_MS  || 30_000);  // how often to scan logs
const LOG_COOLDOWN = Number(process.env.LOG_COOLDOWN_MS || 60_000); // min gap between log alerts

// ── Critical / warning keywords ──────────────────────────────────────────
const CRITICAL_KW = ['out of memory', 'oom kill', 'oom-kill', 'kernel panic', 'panic',
                     'fatal', 'segfault', 'segmentation fault', 'killed process', 'stack overflow'];
const WARNING_KW  = ['connection refused', 'connection reset', 'connection timed out',
                     'timeout', 'too many open files', 'no space left', 'disk quota'];

// ── State ────────────────────────────────────────────────────────────────
let serverId    = null;
let lastLogAlert = 0;   // epoch ms of last pushed log alert

// ── Logging ──────────────────────────────────────────────────────────────
const log = (tag, msg) =>
  console.log(`[${new Date().toISOString()}] [${tag}] ${msg}`);

// ── HTTP helpers (built-in fetch, Node 18+) ──────────────────────────────
async function post(urlPath, body) {
  const res = await fetch(`${BACKEND}${urlPath}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function get(urlPath) {
  const res = await fetch(`${BACKEND}${urlPath}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function getLocalIp() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return '127.0.0.1';
}

// ─────────────────────────────────────────────────────────────────────────
// 1. REGISTRATION
// ─────────────────────────────────────────────────────────────────────────
async function register() {
  log('INFO', `Registering "${NAME}" (${getLocalIp()}) in ${REGION}…`);
  try {
    const data = await post('/api/servers/register-server', {
      name: NAME, ip_address: getLocalIp(), region: REGION,
    });
    serverId = data.id;
    log('OK', `Registered — server ID: ${serverId}`);
  } catch (err) {
    log('ERROR', `Registration failed: ${err.message} — retrying in 30s`);
    setTimeout(register, 30_000);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 2. COMMAND EXECUTION
// ─────────────────────────────────────────────────────────────────────────
async function pollCommands() {
  if (!serverId) return;
  try {
    const data = await get(`/api/commands/${serverId}`);
    if (!data?.command) return;

    log('CMD', `Received: "${data.command}"`);
    await executeAction(data.command);
    await post(`/api/commands/${serverId}/ack`, {
      executed_at: new Date().toISOString(),
      result:      'success',
    }).catch(() => {});
  } catch { /* backend unreachable — silent */ }
}

async function executeAction(action) {
  switch (action) {

    case 'restart_service': {
      // Replace the execSync line below with: execSync('systemctl restart YOUR_SERVICE')
      log('CMD', 'restart_service → running restart hook…');
      try {
        execSync(process.env.RESTART_CMD || 'echo "no RESTART_CMD set"',
          { timeout: 10_000, stdio: 'inherit' });
        log('OK', 'Service restarted.');
      } catch (e) { log('ERROR', `restart failed: ${e.message}`); }
      break;
    }

    case 'kill_process': {
      log('CMD', 'kill_process → killing top CPU consumer…');
      try {
        const selfPid = process.pid;
        const topPid  = execSync(
          `ps aux --sort=-%cpu 2>/dev/null | awk 'NR==2{print $2}' | grep -v ${selfPid}`,
          { encoding: 'utf8', timeout: 3_000 }
        ).trim();
        if (topPid && !isNaN(topPid)) {
          execSync(`kill -15 ${topPid}`, { timeout: 2_000 });
          log('OK', `PID ${topPid} killed.`);
        } else {
          log('WARN', 'No killable target found.');
        }
      } catch (e) { log('ERROR', `kill failed: ${e.message}`); }
      break;
    }

    case 'scale_up': {
      // Replace with your orchestrator CLI (kubectl, doctl, aws ecs, etc.)
      log('CMD', 'scale_up → running scale hook…');
      try {
        execSync(process.env.SCALE_CMD || 'echo "no SCALE_CMD set"',
          { timeout: 15_000, stdio: 'inherit' });
        log('OK', 'Scale-up dispatched.');
      } catch (e) { log('ERROR', `scale failed: ${e.message}`); }
      break;
    }

    default:
      log('WARN', `Unknown action "${action}" — no handler.`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 3. LOG SCANNING + ALERT PUSH
// ─────────────────────────────────────────────────────────────────────────
function readRecentLogs() {
  const cmds = [
    // Linux systemd journal — last 60 lines, errors only
    'journalctl -n 60 --no-pager -p err 2>/dev/null | tail -20',
    // Syslog fallback
    'tail -n 60 /var/log/syslog 2>/dev/null | grep -iE "error|crit|fatal|oom" | tail -20',
    // macOS (dev/local)
    'log show --last 60s --style compact 2>/dev/null | grep -iE "error|crit|warn" | tail -20',
  ];
  for (const cmd of cmds) {
    try {
      const out = execSync(cmd, { timeout: 3_000, encoding: 'utf8' }).trim();
      if (out) return out;
    } catch { /* try next */ }
  }
  return null;
}

function classifyLogs(raw) {
  if (!raw) return null;
  const lower = raw.toLowerCase();

  // Ignore noisy SSH scanner lines
  const lines = raw.split('\n').filter(l =>
    !/kex_exchange_identification|connection closed by|invalid user|preauth/i.test(l)
  );

  const matched = [];
  let severity  = null;

  for (const kw of CRITICAL_KW) {
    if (lower.includes(kw)) { severity = 'critical'; matched.push(kw); }
  }
  if (!severity) {
    for (const kw of WARNING_KW) {
      if (lower.includes(kw)) { severity = 'warning'; matched.push(kw); }
    }
  }
  if (!severity) return null; // nothing noteworthy

  const errorLines = lines.filter(l => /error|crit|fatal|warn|oom/i.test(l)).slice(0, 3);
  const summary    = errorLines
    .map(l => l.replace(/^\w+ +\d+ +\d+:\d+:\d+ +\S+ /, '').trim().slice(0, 140))
    .join(' | ') || matched.join(', ');

  return { severity, summary, matched_keywords: [...new Set(matched)] };
}

async function scanAndAlert() {
  if (!serverId) return;

  const now = Date.now();
  if (now - lastLogAlert < LOG_COOLDOWN) return; // respect cooldown

  const result = classifyLogs(readRecentLogs());
  if (!result) return; // logs are clean

  log('ALERT', `[${result.severity.toUpperCase()}] ${result.summary.slice(0, 120)}`);

  try {
    await post('/api/metrics', {
      server_id:   serverId,
      severity:    result.severity,
      issue_type:  'log_' + result.severity,
      log_summary: result.summary,
      is_anomaly:  true,
      anomalies:   ['log_' + result.severity],
      // null out metric fields so backend doesn't misinterpret
      cpu: null, memory: null, uptime: null,
    });
    lastLogAlert = now;
    log('OK', 'Log alert pushed to backend.');
  } catch (err) {
    log('ERROR', `Alert push failed: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('  SelfHeal Lightweight Agent v3.0');
  console.log(`  Backend : ${BACKEND}`);
  console.log(`  Name    : ${NAME}`);
  console.log(`  Region  : ${REGION}`);
  console.log(`  IP      : ${getLocalIp()}`);
  console.log(`  Cmd poll: every ${CMD_POLL / 1000}s`);
  console.log(`  Log scan: every ${LOG_POLL / 1000}s`);
  console.log('');

  await register();
  if (!serverId) return; // registration failed — exit after retries

  setInterval(pollCommands, CMD_POLL);
  setInterval(scanAndAlert, LOG_POLL);

  // First log scan immediately after startup
  setTimeout(scanAndAlert, 5_000);

  process.on('SIGINT',  () => { log('INFO', 'Shutting down.'); process.exit(0); });
  process.on('SIGTERM', () => { log('INFO', 'Shutting down.'); process.exit(0); });

  log('OK', 'Agent running. Waiting for commands and scanning logs…');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
