const { audit } = require('./audit');

class Worker {
  constructor(db, queue, handlers, { leaseMs = 30000, gate = null } = {}) {
    this.db = db;
    this.queue = queue;
    this.handlers = handlers;
    this.leaseMs = leaseMs;
    this.gate = gate;
  }

  // Process exactly one due job. Returns false when the queue is empty.
  async tick() {
    const job = this.queue.claim(this.leaseMs);
    if (!job) return false;

    const payload = JSON.parse(job.payload);

    // The gate runs before the handler, so a held job's side effect has not
    // happened yet when a person is asked about it.
    if (this.gate) {
      const verdict = this.gate.check(job, payload);
      if (verdict.action === 'hold') {
        this.queue.hold(job.id);
        return true;
      }
      if (verdict.action === 'stop') {
        this.queue.halt(job.id, verdict.approval.status, `approval ${verdict.approval.status}`);
        return true;
      }
    }

    const handler = this.handlers[job.type];
    try {
      if (!handler) throw new Error(`no handler for type "${job.type}"`);
      await handler(payload, job);
      this.queue.complete(job.id);
      audit(this.db, 'job.completed', job.id, { type: job.type });
    } catch (err) {
      this.queue.fail(job, err.message);
      audit(this.db, 'job.failed', job.id, { type: job.type, error: err.message });
    }
    return true;
  }

  // Drain everything currently due. Crashed jobs are recovered first, and
  // approvals nobody answered are closed out, before any work is claimed.
  async drain() {
    this.queue.recoverExpiredLeases();
    if (this.gate) this.gate.expireOverdue();
    let processed = 0;
    while (await this.tick()) processed++;
    return processed;
  }
}

module.exports = { Worker };
