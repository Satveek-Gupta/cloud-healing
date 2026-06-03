'use strict';

/**
 * app.js — Express application factory
 *
 * Creates and configures the Express app without starting the server.
 * This separation makes the app testable — you can import createApp()
 * in tests without binding to a port.
 */

const express       = require('express');
const helmet        = require('helmet');
const cors          = require('cors');
const config        = require('./config/env');
const requestLogger = require('./middleware/requestLogger');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const apiRouter     = require('./routes/index');

function createApp() {
  const app = express();

  // ── Security headers ────────────────────────────────────────────────────
  // helmet sets X-Content-Type-Options, X-Frame-Options, removes X-Powered-By, etc.
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // allow agent fetches
    contentSecurityPolicy: false, // API — no CSP needed
  }));

  // ── CORS ────────────────────────────────────────────────────────────────
  const origin = config.frontendUrl
    ? [config.frontendUrl, 'http://localhost:3000']
    : true; // allow all in dev / when no FRONTEND_URL set

  app.use(cors({ origin, credentials: true }));

  // ── Body parsing ────────────────────────────────────────────────────────
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  // ── Request logging ─────────────────────────────────────────────────────
  app.use(requestLogger);

  // ── Health check ─────────────────────────────────────────────────────────
  // Mounted before auth/rate-limiting so load balancers always get a fast response
  app.get('/health', (req, res) =>
    res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() })
  );

  // ── API routes ───────────────────────────────────────────────────────────
  app.use('/api', apiRouter);

  // ── 404 + Error handling ─────────────────────────────────────────────────
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
