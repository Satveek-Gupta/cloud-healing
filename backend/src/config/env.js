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
  corsAllowedOrigins: (process.env.CORS_ALLOWED_ORIGINS || process.env.FRONTEND_URL || 'http://localhost:3000')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),

  // ── Supabase ─────────────────────────────────────────────────────────────
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseKey: process.env.SUPABASE_KEY || '',

  // ── AI providers ─────────────────────────────────────────────────────────
  geminiKey:   (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim(),
  geminiModel: process.env.GEMINI_MODEL   || 'gemini-2.0-flash',
  openaiKey:   process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL   || 'gpt-4o-mini',
  allowAiMock: process.env.ALLOW_AI_MOCK === 'true' || process.env.ALLOW_AI_MOCK === '1',

  // Clerk auth. CLERK_AUDIENCE and CLERK_ISSUER are required for production.
  clerkSecretKey: process.env.CLERK_SECRET_KEY || '',
  clerkJwtKey: process.env.CLERK_JWT_KEY || '',
  clerkIssuer: process.env.CLERK_ISSUER || '',
  clerkAudience: process.env.CLERK_AUDIENCE || '',
  clerkAuthorizedParties: (process.env.CLERK_AUTHORIZED_PARTIES || process.env.FRONTEND_URL || 'http://localhost:3000')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),

  // Server-owned role mapping. Never trust roles sent by clients.
  superadminEmail: (process.env.SUPERADMIN_EMAIL || '').trim().toLowerCase(),
  adminEmail: (process.env.ADMIN_EMAIL || '').trim().toLowerCase(),
});

// Warn on important missing vars at startup (non-fatal)
function warnMissing() {
  const checks = [
    [config.supabaseUrl, 'SUPABASE_URL — running in mock/memory mode'],
    [config.supabaseKey, 'SUPABASE_KEY'],
    [config.geminiKey || config.openaiKey, 'GEMINI_API_KEY or OPENAI_API_KEY — AI healing disabled unless ALLOW_AI_MOCK=true'],
    [config.clerkSecretKey || config.clerkJwtKey, 'CLERK_SECRET_KEY or CLERK_JWT_KEY — authenticated routes will fail closed'],
    [config.clerkIssuer, 'CLERK_ISSUER — JWT issuer validation unavailable'],
    [config.clerkAudience, 'CLERK_AUDIENCE — JWT audience validation unavailable'],
    [config.superadminEmail, 'SUPERADMIN_EMAIL — no superadmin can be assigned'],
    [config.adminEmail, 'ADMIN_EMAIL — no admin can be assigned'],
  ];
  for (const [val, label] of checks) {
    if (!val) console.warn(`[Config] ⚠  Missing: ${label}`);
  }
}

warnMissing();

module.exports = config;
