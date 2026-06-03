'use strict';

/**
 * config/env.js
 * Single source of truth for all environment configuration.
 * Reads from process.env (populated by dotenv in server.js).
 * Exports a frozen config object — no more scattered process.env calls.
 */

const config = Object.freeze({
  // ── Server ──────────────────────────────────────────────────────────────
  port:    parseInt(process.env.PORT || '8000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  get isDev() { return this.nodeEnv !== 'production'; },

  // ── CORS ─────────────────────────────────────────────────────────────────
  frontendUrl: process.env.FRONTEND_URL || null,

  // ── Supabase ─────────────────────────────────────────────────────────────
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseKey: process.env.SUPABASE_KEY || '',

  // ── AI providers ─────────────────────────────────────────────────────────
  geminiKey:   (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim(),
  geminiModel: process.env.GEMINI_MODEL   || 'gemini-2.0-flash',
  openaiKey:   process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL   || 'gpt-4o-mini',
  allowAiMock: process.env.ALLOW_AI_MOCK === 'true' || process.env.ALLOW_AI_MOCK === '1',
});

// Warn on important missing vars at startup (non-fatal)
function warnMissing() {
  const checks = [
    [config.supabaseUrl, 'SUPABASE_URL — running in mock/memory mode'],
    [config.supabaseKey, 'SUPABASE_KEY'],
    [config.geminiKey || config.openaiKey, 'GEMINI_API_KEY or OPENAI_API_KEY — AI healing disabled unless ALLOW_AI_MOCK=true'],
  ];
  for (const [val, label] of checks) {
    if (!val) console.warn(`[Config] ⚠  Missing: ${label}`);
  }
}

warnMissing();

module.exports = config;
