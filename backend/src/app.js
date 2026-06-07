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
const { apiLimiter } = require('./middleware/security');
const apiRouter     = require('./routes/index');

function createApp() {
  const app = express();

  // ── Security headers ────────────────────────────────────────────────────
  // helmet sets X-Content-Type-Options, X-Frame-Options, removes X-Powered-By, etc.
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false,
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'no-referrer' },
    hsts: config.isDev ? false : { maxAge: 31536000, includeSubDomains: true, preload: true },
  }));

  // ── CORS ────────────────────────────────────────────────────────────────
  app.use(cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (config.corsAllowedOrigins.includes(origin)) return cb(null, true);
      return cb(Object.assign(new Error('CORS origin denied'), { status: 403 }));
    },
    credentials: true,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  }));

  // ── Body parsing ────────────────────────────────────────────────────────
  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));

  // ── Request logging ─────────────────────────────────────────────────────
  app.use(requestLogger);
  app.use('/api', apiLimiter);

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
