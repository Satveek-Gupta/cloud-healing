#!/usr/bin/env node
'use strict';

/**
 * index.js
 * SelfHeal Processing Engine — main entry point.
 *
 * Bootstraps:
 *  - Environment validation
 *  - Supabase client
 *  - Graceful shutdown handlers
 *  - Redis Streams consumer
 */

require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const { startConsumer } = require('./consumer');

// ── Structured logger ────────────────────────────────────────────────────────
const log = (level, msg) =>
  console.log(`[${new Date().toISOString()}] [${level}] ${msg}`);

// ── Banner ───────────────────────────────────────────────────────────────────
function printBanner() {
  console.log(`
  ╔══════════════════════════════════════╗
  ║    SelfHeal Processing Engine v1.0  ║
  ║    Telemetry Consumer + Analyzer     ║
  ╚══════════════════════════════════════╝
  `);
}

// ── Environment validation ───────────────────────────────────────────────────
function validateEnv() {
  const required = ['SUPABASE_URL', 'SUPABASE_KEY'];
  const missing  = required.filter(k => !process.env[k]);

  if (missing.length > 0) {
    console.error(`[FATAL] Missing required environment variables: ${missing.join(', ')}`);
    console.error('        Copy .env.example → .env and fill in the values.');
    process.exit(1);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  printBanner();
  validateEnv();

  log('INFO', 'Initializing Supabase client…');
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY,
    {
      auth: { persistSession: false }, // Server-side — no session persistence needed
    },
  );

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  const shutdown = (signal) => {
    log('INFO', `Received ${signal} — shutting down gracefully…`);
    // ioredis connections are cleaned up by the OS on process exit.
    // If you add explicit cleanup logic (e.g. flush metrics), do it here.
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  process.on('uncaughtException', (err) => {
    log('ERROR', `Uncaught exception: ${err.message}\n${err.stack}`);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    log('ERROR', `Unhandled promise rejection: ${msg}`);
    process.exit(1);
  });

  // ── Start consumer (blocking) ──────────────────────────────────────────────
  log('INFO', 'Starting consumer…');
  await startConsumer(supabase);
}

main().catch(err => {
  console.error(`[FATAL] ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
