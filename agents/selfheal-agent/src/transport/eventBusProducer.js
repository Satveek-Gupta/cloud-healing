'use strict';

/**
 * Abstract base class for event bus producers.
 * All transport implementations must extend this class.
 */
class EventBusProducer {
  /**
   * Establish a connection to the event bus.
   * @returns {Promise<void>}
   */
  async connect() {
    throw new Error('Not implemented');
  }

  /**
   * Publish a payload to the specified stream/topic.
   * @param {string} stream  - The target stream or topic name.
   * @param {Object} payload - Key-value payload to publish.
   * @returns {Promise<void>}
   */
  async publish(stream, payload) {
    throw new Error('Not implemented');
  }

  /**
   * Gracefully disconnect from the event bus.
   * @returns {Promise<void>}
   */
  async disconnect() {
    throw new Error('Not implemented');
  }
}

module.exports = EventBusProducer;
