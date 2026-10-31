const { audit } = require('./audit');
const { makePolicy } = require('./policy');
const { silent } = require('./notify');

const now = () => Date.now();
const DAY = 24 * 60 * 60 * 1000;

// The approval gate.
//
// The worker asks the gate about every job it claims, before the handler runs.
// The gate answers with one of three actions:
//
//   run   nothing here needs a person, or a person already said yes
//   hold  park the job and wait for a decision
//   stop  a person said no, or nobody answered in time
//
// The policy is consulted once, the first time a job reaches the gate, and the
// answer is written down. A later change to the rules does not re-open a job a
// person has already approved, which is the behaviour anyone reviewing an
// audit log expects.
class Gate {
  constructor(db, queue, { policy = makePolicy(), ttlMs = DAY, notifier = silent() } = {}) {
    this.db = db;
    this.queue = queue;
    this.policy = policy;
    this.ttlMs = ttlMs;
    this.notifier = notifier;
  }

  check(job, payload = {}) {
    const existing = this.findByJob(job.id);
    if (existing) {
      if (existing.status === 'approved') return { action: 'run', approval: existing };
      if (existing.status === 'pending') return { action: 'hold', approval: existing, fresh: false };
      return { action: 'stop', approval: existing };
    }

    const { hold, reason } = this.policy.review(job, payload);
    if (!hold) return { action: 'run', approval: null };
    return { action: 'hold', approval: this.request(job, reason), fresh: true };
  }

  request(job, reason) {
    const t = now();
    const info = this.db.prepare(`
      INSERT OR IGNORE INTO approvals (job_id, reason, status, requested_at, expires_at)
      VALUES (?, ?, 'pending', ?, ?)
    `).run(job.id, reason, t, t + this.ttlMs);
    const approval = this.findByJob(job.id);
    // Only on the row that was actually created. A job claimed, held and
    // claimed again must not alert anyone a second time, and a notifier that
    // throws must not fail the job.
    if (info.changes === 1) {
      audit(this.db, 'approval.requested', job.id, { type: job.type, reason });
      try {
        this.notifier.notify({ approval, job, reason });
      } catch (err) {
        audit(this.db, 'notify.failed', job.id, { error: err.message });
      }
    }
    return approval;
  }

  get(id) {
    return this.db.prepare('SELECT * FROM approvals WHERE id = ?').get(id);
  }

  findByJob(jobId) {
    return this.db.prepare('SELECT * FROM approvals WHERE job_id = ?').get(jobId);
  }

  pending() {
    return this.db.prepare(`
      SELECT a.*, j.type, j.payload
      FROM approvals a JOIN jobs j ON j.id = a.job_id
      WHERE a.status = 'pending'
      ORDER BY a.requested_at ASC
    `).all();
  }

  approve(id, by, note) { return this.decide(id, 'approved', by, note); }
  reject(id, by, note)  { return this.decide(id, 'rejected', by, note); }

  // One decision per approval, ever. The UPDATE is conditional on the row still
  // being pending, so two reviewers pressing Approve at the same moment produce
  // one decision and one run, and a second press of the same button changes
  // nothing. The job is released inside the same transaction as the decision.
  decide(id, status, by = null, note = null) {
    const apply = this.db.transaction(() => {
      const changed = this.db.prepare(`
        UPDATE approvals SET status=?, decided_at=?, decided_by=?, note=?
        WHERE id=? AND status='pending'
      `).run(status, now(), by, note, id).changes;

      const approval = this.get(id);
      if (changed === 0) return { changed: false, approval };

      if (status === 'approved') this.queue.release(approval.job_id);
      else this.queue.halt(approval.job_id, 'rejected', `rejected by ${by || 'a reviewer'}`);

      audit(this.db, `approval.${status}`, approval.job_id, { by, note });
      return { changed: true, approval };
    });
    return apply();
  }

  // Nobody answered. Silence is not consent, so the job is stopped rather than
  // left in the queue forever.
  expireOverdue() {
    const due = this.db.prepare(
      `SELECT * FROM approvals WHERE status='pending' AND expires_at <= ?`
    ).all(now());

    for (const approval of due) {
      const changed = this.db.prepare(
        `UPDATE approvals SET status='expired', decided_at=? WHERE id=? AND status='pending'`
      ).run(now(), approval.id).changes;
      if (changed === 0) continue;
      this.queue.halt(approval.job_id, 'expired', 'nobody approved it in time');
      audit(this.db, 'approval.expired', approval.job_id, { reason: approval.reason });
    }
    return due.length;
  }
}

module.exports = { Gate };
