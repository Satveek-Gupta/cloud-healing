'use strict';

/**
 * middleware/requestLogger.js
 * Structured per-request logger — prints method, path, status, and duration
 * on every response. Lightweight alternative to morgan for this project.
 */

const SKIP_PATHS = new Set(['/health']);

module.exports = function requestLogger(req, res, next) {
  if (SKIP_PATHS.has(req.path)) return next();

  const start = Date.now();
  res.on('finish', () => {
    const ms  = Date.now() - start;
    const lvl = res.statusCode >= 500 ? '❌' : res.statusCode >= 400 ? '⚠ ' : '✅';
    const ts  = new Date().toISOString();
    console.log(`${lvl} [${ts}] ${req.method} ${req.originalUrl} → ${res.statusCode} (${ms}ms)`);
  });

  next();
};
