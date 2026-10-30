const { test } = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { Queue } = require('../src/queue');
const { Worker } = require('../src/worker');
const { makeEmailConnector } = require('../src/connectors/email');

function freshDb() {
  return openDb(':memory:');
}

test('enqueue with the same idempotency key does not create a second job', () => {
  const db = freshDb();
  const q = new Queue(db);
  const a = q.enqueue({ type: 'noop', idempotencyKey: 'order-42' });
  const b = q.enqueue({ type: 'noop', idempotencyKey: 'order-42' });
  assert.equal(a.id, b.id);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM jobs').get().n, 1);
});

test('a successful job ends as completed', async () => {
  const db = freshDb();
  const q = new Queue(db);
  q.enqueue({ type: 'noop' });
  const w = new Worker(db, q, { noop: async () => {} });
  await w.drain();
  assert.deepEqual(q.counts(), { completed: 1 });
});

test('a failing job retries until max_attempts, then fails', async () => {
  const db = freshDb();
  const q = new Queue(db);
  q.enqueue({ type: 'boom', maxAttempts: 3, runAt: 0 });
  const handlers = { boom: async () => { throw new Error('nope'); } };
  const w = new Worker(db, q, handlers);

  // Each drain runs the job once; we force next_run_at back to now between tries.
  for (let i = 0; i < 3; i++) {
    db.prepare(`UPDATE jobs SET next_run_at = 0 WHERE status='pending'`).run();
    await w.drain();
  }
  const job = q.get(1);
  assert.equal(job.status, 'failed');
  assert.equal(job.attempts, 3);
  assert.match(job.last_error, /nope/);
});

test('a crash mid-job does not send a duplicate email after recovery', async () => {
  const db = freshDb();
  const q = new Queue(db);
  const email = makeEmailConnector(db);

  // This handler does its side effect, then throws BEFORE the job is marked done,
  // exactly like a process dying mid-flight.
  const handlers = {
    welcome: async (payload, job) => {
      email.send({ key: `welcome:${job.id}`, to: payload.to, subject: 'Welcome' });
      throw new Error('process died after sending');
    },
  };

  q.enqueue({ type: 'welcome', payload: { to: 'ali@example.com' }, maxAttempts: 5 });

  // First pass: claim with a tiny lease, run the handler by hand so the throw
  // escapes (simulating a hard crash where complete/fail never run).
  const job = q.claim(1);
  await assert.rejects(() => handlers.welcome(JSON.parse(job.payload), job));
  assert.equal(email.count(), 1);

  // Lease has now expired. A fresh worker recovers and reruns the job.
  await new Promise(r => setTimeout(r, 5));
  const handlersSafe = {
    welcome: async (payload, jb) => {
      email.send({ key: `welcome:${jb.id}`, to: payload.to, subject: 'Welcome' });
    },
  };
  const w = new Worker(db, q, handlersSafe);
  await w.drain();

  // The key assertion: the email was sent exactly once across the crash.
  assert.equal(email.count(), 1);
  assert.equal(q.get(job.id).status, 'completed');
});
