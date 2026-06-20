'use strict';
/**
 * lib/eventBus/index.js
 * Pluggable EventBus interface.
 * Swap out the adapter without changing the caller code.
 */

class EventBusProducer {
  /** Connect to the event bus */
  async connect() { throw new Error('Not implemented'); }
  /** Publish a payload to the given stream/topic */
  async publish(stream, payload) { throw new Error('Not implemented'); }
  /** Graceful shutdown */
  async disconnect() { throw new Error('Not implemented'); }
}

class EventBusConsumer {
  /** Connect and start consuming */
  async consume(stream, groupName, consumerName, handler) { throw new Error('Not implemented'); }
  async disconnect() { throw new Error('Not implemented'); }
}

module.exports = { EventBusProducer, EventBusConsumer };
