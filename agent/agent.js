#!/usr/bin/env node
/**
 * SelfHeal Micro-Agent v4.0
 *
 * Two responsibilities only:
 *   1. Poll backend for healing commands → execute locally
 *   2. Scan system logs → push alert if critical/warning keywords found
 *
 * Zero npm dependencies. Node 22+ (built-in fetch).
 *
 * Env vars (all optional — sane defaults):
 *   BACKEND_URL       Backend base URL           default: http://localhost:5000
 *   SERVER_NAME       Human name for this node   default: OS hostname
 *   REGION            Region tag                 default: local
 *   RESTART_CMD       Shell command for restart  default: (echo warning)
 *   SCALE_CMD         Shell command for scale-up default: (echo warning)
 *   CMD_POLL_MS       Command poll interval (ms) default: 5000
 *   LOG_POLL_MS       Log scan interval (ms)     default: 30000
 *   LOG_COOLDOWN_MS   Min gap between alerts (ms)default: 60000
 */

'use strict';

const os          = require('os');
const fs          = require('fs');
const path        = require('path');
const { execSync } = require('child_process');

// ── .env loader (no dotenv needed) ───────────────────────────────────────────
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const [k, ...v] = t.split('=');
    // Strip inline comments: everything after whitespace + #
    const val = v.join('=').trim().replace(/\s+#.*$/, '');
    if (k && !process.env[k]) process.env[k] = val;
  }
} catch { /* no .env — fine */ }

// ── Config ────────────────────────────────────────────────────────────────────
const BACKEND      = (process.env.BACKEND_URL     || 'http://localhost:5000').replace(/\/$/, '');
const NAME         = process.env.SERVER_NAME       || os.hostname();
const REGION       = process.env.REGION            || 'local';
const CMD_POLL     = Number(process.env.CMD_POLL_MS     || 5_000);
const LOG_POLL     = Number(process.env.LOG_POLL_MS     || 30_000);
const LOG_COOLDOWN = Number(process.env.LOG_COOLDOWN_MS || 60_000);

// ── Log keyword lists ─────────────────────────────────────────────────────────
const CRITICAL_KW = [
  'out of memory', 'oom kill', 'oom-kill', 'kernel panic',
  'fatal', 'segfault', 'segmentation fault', 'killed process', 'stack overflow',
];
const WARNING_KW = [
  'connection refused',      // something can't reach a port — real problem
  'connection timed out',    // latency/network issue — worth knowing
  'too many open files',     // fd exhaustion — resource leak
  'no space left',           // disk full — critical in practice
  'disk quota',              // disk quota exceeded
];

// ── State ─────────────────────────────────────────────────────────────────────
let serverId     = null;
let lastLogAlert = 0;

// ── Tiny logger ───────────────────────────────────────────────────────────────
const log = (tag, msg) => console.log(`[${new Date().toISOString()}] [${tag}] ${msg}`);

// ── HTTP helpers (Node 18 native fetch) ───────────────────────────────────────
async function post(urlPath, body) {
  const r = await fetch(`${BACKEND}${urlPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function get(urlPath) {
  const r = await fetch(`${BACKEND}${urlPath}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// ── Local IP (used only for registration) ─────────────────────────────────────
function localIp() {
  for (const ifaces of Object.values(os.networkInterfaces()))
    for (const i of ifaces)
      if (i.family === 'IPv4' && !i.internal) return i.address;
  return '127.0.0.1';
}

// ─────────────────────────────────────────────────────────────────────────────
// A. REGISTRATION  (one-time, retried on failure)
// ─────────────────────────────────────────────────────────────────────────────
async function register() {
  log('INFO', `Registering "${NAME}" @ ${localIp()} [${REGION}]…`);
  try {
    const d = await post('/api/servers/register-server', {
      name: NAME, ip_address: localIp(), region: REGION,
    });
    serverId = d.id;
    log('OK', `Registered — server_id: ${serverId}`);
  } catch (err) {
    log('ERROR', `Registration failed: ${err.message} — retry in 30s`);
    setTimeout(register, 30_000);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// B. COMMAND EXECUTION  (poll → execute → ack)
// ─────────────────────────────────────────────────────────────────────────────
async function pollCommands() {
  if (!serverId) return;
  try {
    const data = await get(`/api/commands/${serverId}`);
    if (!data?.command) return;
    log('CMD', `Received: "${data.command}"`);
    execute(data.command);
    await post(`/api/commands/${serverId}/ack`, {
      executed_at: new Date().toISOString(), result: 'success',
    }).catch(() => {});
  } catch { /* backend unreachable — silent */ }
}

function execute(action) {
  try {
    switch (action) {

      case 'restart_service':
        log('CMD', 'restart_service → running RESTART_CMD…');
        execSync(process.env.RESTART_CMD || 'echo "[agent] WARNING: RESTART_CMD not set"',
          { timeout: 10_000, stdio: 'inherit' });
        log('OK', 'Service restarted.');
        break;

      case 'kill_process':
        log('CMD', 'kill_process → killing top CPU consumer…');
        const top = execSync(
          `ps aux --sort=-%cpu 2>/dev/null | awk 'NR==2{print $2}' | grep -v ${process.pid}`,
          { encoding: 'utf8', timeout: 3_000 }
        ).trim();
        if (top && !isNaN(top)) {
          execSync(`kill -15 ${top}`, { timeout: 2_000 });
          log('OK', `PID ${top} sent SIGTERM.`);
        } else {
          log('WARN', 'No killable target found.');
        }
        break;

      case 'scale_up':
        log('CMD', 'scale_up → running SCALE_CMD…');
        execSync(process.env.SCALE_CMD || 'echo "[agent] WARNING: SCALE_CMD not set"',
          { timeout: 15_000, stdio: 'inherit' });
        log('OK', 'Scale-up dispatched.');
        break;

      default:
        log('WARN', `Unknown action "${action}" — no handler.`);
    }
  } catch (e) {
    log('ERROR', `execute(${action}) failed: ${e.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// C. LOG SCANNING + ALERT PUSH
// ─────────────────────────────────────────────────────────────────────────────
function readLogs() {
  const cmds = [
    'journalctl -n 60 --no-pager -p err 2>/dev/null | tail -20',         // Linux systemd
    'tail -n 60 /var/log/syslog 2>/dev/null | grep -iE "error|crit|fatal|oom" | tail -20', // syslog fallback
    'log show --last 60s --style compact 2>/dev/null | grep -iE "error|crit|warn" | tail -20', // macOS (dev)
  ];
  for (const cmd of cmds) {
    try {
      const out = execSync(cmd, { timeout: 3_000, encoding: 'utf8' }).trim();
      if (out) return out;
    } catch { /* try next */ }
  }
  return null;
}

function classify(raw) {
  if (!raw) return null;
  const lower   = raw.toLowerCase();
  const lines   = raw.split('\n').filter(
    l => !/kex_exchange_identification|connection closed by|invalid user|preauth/i.test(l)
  );

  let severity = null;
  const matched = [];

  for (const kw of CRITICAL_KW) if (lower.includes(kw)) { severity = 'critical'; matched.push(kw); }
  if (!severity)
    for (const kw of WARNING_KW) if (lower.includes(kw)) { severity = 'warning';  matched.push(kw); }
  if (!severity) return null;

  const errorLines = lines
    .filter(l => /error|crit|fatal|warn|oom/i.test(l))
    .slice(0, 3)
    .map(l => l.replace(/^\w+ +\d+ +\d+:\d+:\d+ +\S+ /, '').trim().slice(0, 140));

  const summary = errorLines.join(' | ') || matched.join(', ');
  return { severity, summary, matched_keywords: [...new Set(matched)] };
}

async function scanAndAlert() {
  if (!serverId) return;
  const now = Date.now();
  if (now - lastLogAlert < LOG_COOLDOWN) return;

  const result = classify(readLogs());
  if (!result) return;

  log('ALERT', `[${result.severity.toUpperCase()}] ${result.summary.slice(0, 120)}`);
  try {
    await post('/api/metrics', {
      server_id:   serverId,
      severity:    result.severity,
      issue_type:  'log_' + result.severity,
      log_summary: result.summary,
      is_anomaly:  true,
      anomalies:   ['log_' + result.severity],
      cpu: null, memory: null, uptime: null,
    });
    lastLogAlert = now;
    log('OK', 'Log alert pushed.');
  } catch (err) {
    log('ERROR', `Alert push failed: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`
  SelfHeal Micro-Agent v4.0
  Backend : ${BACKEND}
  Name    : ${NAME}  |  Region: ${REGION}
  Cmd poll: every ${CMD_POLL / 1000}s
  Log scan: every ${LOG_POLL / 1000}s  (cooldown ${LOG_COOLDOWN / 1000}s)
  `);

  await register();

  setInterval(pollCommands, CMD_POLL);
  setInterval(scanAndAlert, LOG_POLL);
  setTimeout(scanAndAlert, 5_000);   // first scan 5s after boot

  process.on('SIGINT',  () => { log('INFO', 'Shutting down.'); process.exit(0); });
  process.on('SIGTERM', () => { log('INFO', 'Shutting down.'); process.exit(0); });

  log('OK', 'Agent running — polling commands + scanning logs.');
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
