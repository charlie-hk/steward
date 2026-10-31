const now = () => Date.now();

class Queue {
  constructor(db) {
    this.db = db;
  }

  enqueue({ type, payload = {}, idempotencyKey = null, maxAttempts = 3, runAt = now() }) {
    const t = now();
    try {
      const info = this.db.prepare(`
        INSERT INTO jobs (type, payload, status, idempotency_key, max_attempts, next_run_at, created_at, updated_at)
        VALUES (?, ?, 'pending', ?, ?, ?, ?, ?)
      `).run(type, JSON.stringify(payload), idempotencyKey, maxAttempts, runAt, t, t);
      return this.get(info.lastInsertRowid);
    } catch (err) {
      // Same idempotency key already enqueued: return the original, do not duplicate.
      if (idempotencyKey && /UNIQUE/.test(err.message)) {
        return this.db.prepare('SELECT * FROM jobs WHERE idempotency_key = ?').get(idempotencyKey);
      }
      throw err;
    }
  }

  get(id) {
    return this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  }

  // Atomically take the next due job and lease it. Returns null if nothing is due.
  claim(leaseMs) {
    const take = this.db.transaction(() => {
      const job = this.db.prepare(`
        SELECT * FROM jobs
        WHERE status = 'pending' AND next_run_at <= ?
        ORDER BY next_run_at ASC, id ASC
        LIMIT 1
      `).get(now());
      if (!job) return null;
      this.db.prepare(`UPDATE jobs SET status='in_progress', lease_until=?, updated_at=? WHERE id=?`)
        .run(now() + leaseMs, now(), job.id);
      return this.get(job.id);
    });
    return take();
  }

  complete(id) {
    this.db.prepare(`UPDATE jobs SET status='completed', lease_until=NULL, updated_at=? WHERE id=?`)
      .run(now(), id);
  }

  fail(job, errMessage) {
    const attempts = job.attempts + 1;
    if (attempts >= job.max_attempts) {
      this.db.prepare(`UPDATE jobs SET status='failed', attempts=?, last_error=?, lease_until=NULL, updated_at=? WHERE id=?`)
        .run(attempts, errMessage, now(), job.id);
    } else {
      const backoff = Math.min(30000, 1000 * 2 ** attempts);
      this.db.prepare(`UPDATE jobs SET status='pending', attempts=?, last_error=?, next_run_at=?, lease_until=NULL, updated_at=? WHERE id=?`)
        .run(attempts, errMessage, now() + backoff, now(), job.id);
    }
  }

  // Parked until a person decides. Not claimable while it sits here, and no
  // attempt is consumed: waiting for approval is not a failure.
  hold(id) {
    this.db.prepare(`UPDATE jobs SET status='awaiting_approval', lease_until=NULL, updated_at=? WHERE id=?`)
      .run(now(), id);
  }

  // Back in the queue, due immediately.
  release(id) {
    this.db.prepare(`UPDATE jobs SET status='pending', next_run_at=?, lease_until=NULL, updated_at=? WHERE id=?`)
      .run(now(), now(), id);
  }

  // Terminal, and deliberately not 'failed': the job did not break, it was not
  // allowed to run. Retrying it would be wrong, so no attempt is consumed.
  halt(id, status, reason) {
    this.db.prepare(`UPDATE jobs SET status=?, last_error=?, lease_until=NULL, updated_at=? WHERE id=?`)
      .run(status, reason, now(), id);
  }

  // A worker that died left jobs stuck in 'in_progress'. Any whose lease has
  // expired are returned to the queue so another worker can pick them up.
  recoverExpiredLeases() {
    const res = this.db.prepare(`
      UPDATE jobs SET status='pending', lease_until=NULL, updated_at=?
      WHERE status='in_progress' AND lease_until IS NOT NULL AND lease_until < ?
    `).run(now(), now());
    return res.changes;
  }

  counts() {
    const rows = this.db.prepare(`SELECT status, COUNT(*) n FROM jobs GROUP BY status`).all();
    return Object.fromEntries(rows.map(r => [r.status, r.n]));
  }
}

module.exports = { Queue };
