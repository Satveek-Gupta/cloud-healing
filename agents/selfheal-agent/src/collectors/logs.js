'use strict';

const { execSync } = require('child_process');

const CRITICAL_PATTERNS = [
  'out of memory', 'oom kill', 'oom-kill', 'kernel panic',
  'fatal', 'segfault', 'segmentation fault', 'killed process',
  'stack overflow',
];
const ERROR_PATTERNS    = ['error', 'exception', 'failed', 'failure'];
const WARNING_PATTERNS  = [
  'connection refused', 'connection timed out',
  'too many open files', 'no space left', 'disk quota', 'warning',
];

/** Commands to try in order; first one that succeeds is used. */
const LOG_COMMANDS = [
  "journalctl -n 100 --no-pager -p err 2>/dev/null | tail -30",
  "tail -n 100 /var/log/syslog 2>/dev/null | grep -iE 'error|crit|fatal|oom' | tail -30",
  "log show --last 60s --style compact 2>/dev/null | grep -iE 'error|crit|warn' | tail -30",
];

/**
 * Attempt to run a shell command and return stdout, or null on failure/empty.
 * @param {string} cmd
 * @returns {string|null}
 */
function tryCommand(cmd) {
  try {
    const output = execSync(cmd, { encoding: 'utf8', timeout: 10_000 }).trim();
    return output.length > 0 ? output : null;
  } catch {
    return null;
  }
}

/**
 * Classify severity based on matched keywords in lines.
 * @param {string[]} lines
 * @returns {{ severity: string, matchedKeywords: string[] }}
 */
function classify(lines) {
  const lowerLines = lines.join('\n').toLowerCase();
  const matchedKeywords = [];
  let severity = 'INFO';

  for (const kw of CRITICAL_PATTERNS) {
    if (lowerLines.includes(kw)) {
      matchedKeywords.push(kw);
      severity = 'CRITICAL';
    }
  }
  if (severity !== 'CRITICAL') {
    for (const kw of ERROR_PATTERNS) {
      if (lowerLines.includes(kw)) {
        matchedKeywords.push(kw);
        if (severity !== 'CRITICAL') severity = 'ERROR';
      }
    }
  }
  if (severity === 'INFO') {
    for (const kw of WARNING_PATTERNS) {
      if (lowerLines.includes(kw)) {
        matchedKeywords.push(kw);
        severity = 'WARNING';
      }
    }
  }

  return { severity, matchedKeywords: [...new Set(matchedKeywords)] };
}

/**
 * Collect and classify system logs.
 * @returns {Promise<{
 *   severity: 'INFO'|'WARNING'|'ERROR'|'CRITICAL',
 *   summary: string,
 *   rawLines: string[],
 *   matchedKeywords: string[]
 * }>}
 */
async function collectLogs() {
  let rawLines = [];

  for (const cmd of LOG_COMMANDS) {
    const output = tryCommand(cmd);
    if (output) {
      rawLines = output.split('\n').filter(l => l.trim().length > 0);
      break;
    }
  }

  const { severity, matchedKeywords } = classify(rawLines);
  const summary = rawLines.length > 0
    ? rawLines.slice(0, 3).map(l => l.trim()).join(' | ')
    : 'No relevant log entries found.';

  return { severity, summary, rawLines, matchedKeywords };
}

module.exports = { collectLogs };
