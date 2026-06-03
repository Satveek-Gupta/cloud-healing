'use strict';

const config = require('../config/env');

/**
 * middleware/errorHandler.js
 * Three exports:
 *
 *  asyncHandler(fn)  — wraps async route handlers so rejected promises
 *                      flow to Express error middleware instead of crashing.
 *
 *  notFound          — 404 catch-all; mount AFTER all routes.
 *
 *  errorHandler      — structured JSON error responder; mount LAST (4-arg signature).
 */

/**
 * Wrap an async Express handler so errors reach next() automatically.
 * @param {Function} fn  async (req, res, next) => any
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/** 404 handler — add after all routes. */
function notFound(req, res) {
  res.status(404).json({
    error:  'Not found',
    detail: `${req.method} ${req.originalUrl} does not exist`,
  });
}

/** Global error handler — must have exactly 4 parameters for Express to recognise it. */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = typeof err.status === 'number' ? err.status
               : typeof err.statusCode === 'number' ? err.statusCode
               : 500;

  const message = err.message || 'Internal server error';
  console.error(`[ErrorHandler] ${req.method} ${req.originalUrl} → ${status}: ${message}`);

  res.status(status).json({
    error:   message,
    ...(config.isDev && err.stack ? { stack: err.stack } : {}),
  });
}

module.exports = { asyncHandler, notFound, errorHandler };
