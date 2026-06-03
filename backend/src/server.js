'use strict';

/**
 * server.js — HTTP + WebSocket bootstrap
 *
 * This is the ONLY file that:
 *  - reads .env (via dotenv)
 *  - creates the HTTP server
 *  - binds the WebSocket hub
 *  - calls server.listen()
 *  - handles graceful shutdown
 *
 * Business logic lives in app.js, routes/, and services/.
 */

require('dotenv').config(); // must be first — populates process.env before any imports

const http      = require('http');
const createApp = require('./app');
const config    = require('./config/env');
const { startScraper, stopScraper } = require('./services/scraper');



// ── Create app + server ───────────────────────────────────────────────────────
const app    = createApp();
const server = http.createServer(app);

// ── Start listening ───────────────────────────────────────────────────────────
server.listen(config.port, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║             SelfHeal API  — Production Ready         ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`  Port:      ${config.port}`);
  console.log(`  Env:       ${config.nodeEnv}`);
  console.log(`  Supabase:  ${config.supabaseUrl ? '✅ connected'  : '⚠️  not set (mock mode)'}`);
  console.log(`  Gemini:    ${config.geminiKey   ? '✅ configured' : '⚠️  not set'}`);
  console.log(`  OpenAI:    ${config.openaiKey   ? '✅ configured' : '⚠️  not set'}`);
  console.log(`  AI mock:   ${config.allowAiMock ? '⚠️  enabled'   : '✅ disabled'}`);
  console.log(`  Realtime:  ✅ SSE (GET /api/events)`);
  console.log(`  Scraper:   ✅ Node Exporter pull (30s interval)`);
  console.log('');

  // Start scraping registered servers
  startScraper();

});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
function shutdown(signal) {
  console.log(`\n[Server] ${signal} received — shutting down gracefully...`);

  server.close(err => {
    stopScraper();
    if (err) console.error('[Server] Error during shutdown:', err.message);
    else     console.log('[Server] HTTP server closed. Goodbye.');
    process.exit(err ? 1 : 0);
  });


  // Force-exit after 8 seconds if connections hang
  setTimeout(() => {
    console.error('[Server] Forced exit after 8s timeout.');
    process.exit(1);
  }, 8_000).unref(); // .unref() so it doesn't keep the event loop alive
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// ── Unhandled rejection / exception guards ────────────────────────────────────
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Server] Unhandled Promise Rejection:', reason);
  // Don't crash — log and continue. Swap to process.exit(1) for strict mode.
});

process.on('uncaughtException', err => {
  console.error('[Server] Uncaught Exception:', err.message, err.stack);
  shutdown('uncaughtException');
});
