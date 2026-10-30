const { audit } = require('./audit');

class Worker {
  constructor(db, queue, handlers, { leaseMs = 30000 } = {}) {
    this.db = db;
    this.queue = queue;
    this.handlers = handlers;
    this.leaseMs = leaseMs;
  }

  // Process exactly one due job. Returns false when the queue is empty.
  async tick() {
    const job = this.queue.claim(this.leaseMs);
    if (!job) return false;

    const handler = this.handlers[job.type];
    try {
      if (!handler) throw new Error(`no handler for type "${job.type}"`);
      await handler(JSON.parse(job.payload), job);
      this.queue.complete(job.id);
      audit(this.db, 'job.completed', job.id, { type: job.type });
    } catch (err) {
      this.queue.fail(job, err.message);
      audit(this.db, 'job.failed', job.id, { type: job.type, error: err.message });
    }
    return true;
  }

  // Drain everything currently due. Recovers crashed jobs first.
  async drain() {
    this.queue.recoverExpiredLeases();
    let processed = 0;
    while (await this.tick()) processed++;
    return processed;
  }
}

module.exports = { Worker };
