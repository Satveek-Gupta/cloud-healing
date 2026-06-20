'use strict';

/**
 * consumer.js
 * Redis Streams consumer using Consumer Groups.
 *
 * Flow:
 *  1. Ensure the consumer group exists (XGROUP CREATE … MKSTREAM).
 *  2. On startup, drain any pending (unacknowledged) messages from previous runs.
 *  3. Enter the main loop: XREADGROUP with '>' to fetch new messages.
 *  4. ACK every message after processing (success or controlled failure).
 */

const Redis = require('ioredis');
const { processTelemetryEvent } = require('./pipeline');

const log = (level, msg) =>
  console.log(`[${new Date().toISOString()}] [${level}] [consumer] ${msg}`);

// ── Config (from environment) ────────────────────────────────────────────────
const STREAM_NAME     = process.env.STREAM_NAME     || 'telemetry_stream';
const CONSUMER_GROUP  = process.env.CONSUMER_GROUP  || 'processing-engine';
const CONSUMER_NAME   = process.env.CONSUMER_NAME   || 'engine-1';
const BATCH_SIZE      = parseInt(process.env.BATCH_SIZE  || '10', 10);
const BLOCK_MS        = parseInt(process.env.BLOCK_MS    || '5000', 10);
const REDIS_URL       = process.env.REDIS_URL        || 'redis://localhost:6379';

/**
 * Convert a raw Redis stream entry into a plain key/value object.
 * Redis returns messages as [ id, [field, value, field, value, ...] ].
 *
 * @param {string[]} fields - Flat array of alternating keys and values
 * @returns {Object}
 */
function fieldsToObject(fields) {
  const obj = {};
  for (let i = 0; i < fields.length; i += 2) {
    obj[fields[i]] = fields[i + 1];
  }
  return obj;
}

/**
 * Ensure the consumer group exists for the target stream.
 * Uses MKSTREAM so the stream is created if it doesn't exist yet.
 * Silently ignores BUSYGROUP (group already exists).
 *
 * @param {Redis} redis
 */
async function ensureConsumerGroup(redis) {
  try {
    await redis.xgroup('CREATE', STREAM_NAME, CONSUMER_GROUP, '0', 'MKSTREAM');
    log('INFO', `Consumer group "${CONSUMER_GROUP}" created on stream "${STREAM_NAME}"`);
  } catch (err) {
    if (err.message && err.message.includes('BUSYGROUP')) {
      log('INFO', `Consumer group "${CONSUMER_GROUP}" already exists — resuming`);
    } else {
      throw err;
    }
  }
}

/**
 * Process a single batch of Redis stream messages.
 *
 * @param {Redis}   redis
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Array}   messages - Raw messages from XREADGROUP response
 * @returns {Promise<number>} Number of messages processed
 */
async function processBatch(redis, supabase, messages) {
  let count = 0;

  for (const [id, fields] of messages) {
    const rawEvent = fieldsToObject(fields);
    log('DEBUG', `Processing message ${id} for agent=${rawEvent.agent_id || 'unknown'}`);

    try {
      await processTelemetryEvent(supabase, rawEvent);
    } catch (err) {
      // Log but don't re-throw — we still ACK to avoid infinite retry loops on
      // poison messages. Adjust this policy to a DLQ approach if needed.
      log('ERROR', `Pipeline error for message ${id}: ${err.message}`);
    }

    // ACK regardless of outcome to prevent the message from being stuck in PEL.
    try {
      await redis.xack(STREAM_NAME, CONSUMER_GROUP, id);
      log('DEBUG', `ACKed message ${id}`);
    } catch (err) {
      log('ERROR', `Failed to ACK message ${id}: ${err.message}`);
    }

    count++;
  }

  return count;
}

/**
 * Drain all pending (previously unacknowledged) messages for this consumer.
 * Called once at startup to recover from a crash/restart.
 *
 * @param {Redis}   redis
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
async function drainPendingMessages(redis, supabase) {
  log('INFO', 'Checking for pending (unacknowledged) messages from previous run…');
  let totalRecovered = 0;

  while (true) {
    // Using '0' instead of '>' reads from the Pending Entry List (PEL).
    const response = await redis.xreadgroup(
      'GROUP', CONSUMER_GROUP, CONSUMER_NAME,
      'COUNT', BATCH_SIZE,
      'STREAMS', STREAM_NAME, '0',
    );

    if (!response || response.length === 0) break;

    const [, messages] = response[0];
    if (!messages || messages.length === 0) break;

    const count = await processBatch(redis, supabase, messages);
    totalRecovered += count;

    log('INFO', `Recovered ${count} pending message(s)`);

    // If we got fewer than BATCH_SIZE, there are no more pending messages.
    if (messages.length < BATCH_SIZE) break;
  }

  if (totalRecovered > 0) {
    log('INFO', `Pending message recovery complete — total recovered: ${totalRecovered}`);
  } else {
    log('INFO', 'No pending messages found');
  }
}

/**
 * Main consumer loop. Blocks on XREADGROUP waiting for new messages.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
async function startConsumer(supabase) {
  const redis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: null, // Required for blocking commands
    enableReadyCheck: true,
    lazyConnect: false,
  });

  redis.on('connect', () => log('INFO', `Redis connected to ${REDIS_URL}`));
  redis.on('ready',   () => log('INFO', 'Redis ready'));
  redis.on('error',   err => log('ERROR', `Redis error: ${err.message}`));
  redis.on('close',   () => log('WARN', 'Redis connection closed'));
  redis.on('reconnecting', () => log('INFO', 'Redis reconnecting…'));

  // ── 1. Ensure group exists ─────────────────────────────────────────────
  await ensureConsumerGroup(redis);

  // ── 2. Recover pending messages ────────────────────────────────────────
  await drainPendingMessages(redis, supabase);

  // ── 3. Main processing loop ────────────────────────────────────────────
  log('INFO', `Entering main loop — stream="${STREAM_NAME}" group="${CONSUMER_GROUP}" consumer="${CONSUMER_NAME}" batch=${BATCH_SIZE} blockMs=${BLOCK_MS}`);

  let totalProcessed = 0;
  let consecutiveErrors = 0;
  const MAX_CONSECUTIVE_ERRORS = 10;

  while (true) {
    try {
      // BLOCK waits up to BLOCK_MS ms for new messages (returns null on timeout).
      const response = await redis.xreadgroup(
        'GROUP', CONSUMER_GROUP, CONSUMER_NAME,
        'COUNT', BATCH_SIZE,
        'BLOCK', BLOCK_MS,
        'STREAMS', STREAM_NAME, '>',
      );

      if (!response || response.length === 0) {
        // Timeout (no new messages) — log a heartbeat every ~minute.
        log('DEBUG', `No new messages in ${BLOCK_MS}ms — waiting…`);
        consecutiveErrors = 0;
        continue;
      }

      const [, messages] = response[0];
      if (!messages || messages.length === 0) continue;

      const count = await processBatch(redis, supabase, messages);
      totalProcessed += count;
      consecutiveErrors = 0;

      log('INFO', `Batch complete — processed ${count} message(s) (total: ${totalProcessed})`);
    } catch (err) {
      consecutiveErrors++;
      log('ERROR', `Consumer loop error (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}): ${err.message}`);

      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        log('ERROR', `Too many consecutive errors — exiting to allow process restart`);
        process.exit(1);
      }

      // Back-off before retrying.
      await new Promise(resolve => setTimeout(resolve, Math.min(1000 * consecutiveErrors, 15000)));
    }
  }
}

module.exports = { startConsumer };
