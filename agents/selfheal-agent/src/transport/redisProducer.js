'use strict';

const Redis = require('ioredis');
const EventBusProducer = require('./eventBusProducer');

/**
 * Redis Streams implementation of EventBusProducer.
 * Uses XADD to append entries to a Redis stream.
 */
class RedisProducer extends EventBusProducer {
  /**
   * @param {string} redisUrl - Redis connection URL, e.g. redis://localhost:6379
   */
  constructor(redisUrl) {
    super();
    this.redisUrl = redisUrl;
    this.client   = null;
  }

  /**
   * Connect to Redis.
   * @returns {Promise<void>}
   */
  async connect() {
    this.client = new Redis(this.redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck:     true,
      lazyConnect:          true,
    });
    await this.client.connect();
  }

  /**
   * Publish a payload to a Redis stream via XADD.
   * All values are serialized to strings; objects are JSON-stringified.
   *
   * @param {string} stream  - Redis stream key name.
   * @param {Object} payload - Flat or nested key-value object.
   * @returns {Promise<string>} The entry ID assigned by Redis.
   */
  async publish(stream, payload) {
    if (!this.client) throw new Error('Not connected');
    const fields = [];
    for (const [k, v] of Object.entries(payload)) {
      fields.push(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    }
    // XADD <stream> * <field1> <val1> <field2> <val2> ...
    return this.client.xadd(stream, '*', ...fields);
  }

  /**
   * Gracefully disconnect from Redis.
   * @returns {Promise<void>}
   */
  async disconnect() {
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
  }
}

module.exports = RedisProducer;
