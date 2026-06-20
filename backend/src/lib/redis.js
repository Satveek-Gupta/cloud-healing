'use strict';
/**
 * lib/redis.js
 * Singleton ioredis client. Gracefully no-ops if REDIS_URL is not configured.
 */
const Redis = require('ioredis');

let _client = null;

function getRedis() {
  if (_client) return _client;
  if (!process.env.REDIS_URL) {
    console.warn('[Redis] REDIS_URL not set — Redis features disabled');
    return null;
  }
  _client = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: false,
    lazyConnect: true,
  });
  _client.on('error', err => console.error('[Redis] Client error:', err.message));
  _client.on('connect', () => console.log('[Redis] Connected'));
  return _client;
}

function isRedisReady() {
  return _client !== null && _client.status === 'ready';
}

module.exports = { getRedis, isRedisReady };
