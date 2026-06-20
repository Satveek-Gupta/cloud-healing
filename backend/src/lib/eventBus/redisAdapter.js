'use strict';
/**
 * lib/eventBus/redisAdapter.js
 * Redis Streams implementation of EventBusProducer.
 * Future: add natsAdapter.js or kafkaAdapter.js with the same interface.
 */
const { EventBusProducer } = require('./index');

class RedisStreamProducer extends EventBusProducer {
  constructor(redisClient) {
    super();
    this.client = redisClient;
  }

  async connect() { /* ioredis connects lazily */ }

  async publish(stream, payload) {
    if (!this.client) throw new Error('Redis client not available');
    const fields = [];
    for (const [k, v] of Object.entries(payload)) {
      fields.push(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    }
    await this.client.xadd(stream, '*', ...fields);
  }

  async disconnect() { /* managed by the Redis singleton */ }
}

module.exports = { RedisStreamProducer };
