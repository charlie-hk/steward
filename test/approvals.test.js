const { test } = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { Queue } = require('../src/queue');
const { Worker } = require('../src/worker');
const { Gate } = require('../src/gate');
const { makePolicy, alwaysHold } = require('../src/policy');

// A handler that counts how many times it actually ran. Every test below is
// really one question: did this number move when it should have?
function spy() {
  const calls = [];
  const fn = async (payload) => { calls.push(payload); };
  return { fn, calls };
}

function setup({ policy } = {}) {
  const db = openDb(':memory:');
  const queue = new Queue(db);
  const gate = new Gate(db, queue, policy ? { policy } : {});
  const handler = spy();
  const worker = new Worker(db, queue, { 'payment.send': handler.fn, 'note.write': handler.fn }, { gate });
  return { db, queue, gate, worker, handler };
}

test('a consequential job is held, and its handler does not run', async () => {
  const { queue, gate, worker, handler } = setup();
  const job = queue.enqueue({ type: 'payment.send', payload: { amount: 4820, to: 'bank' } });

  await worker.drain();

  assert.equal(handler.calls.length, 0);
  assert.equal(queue.get(job.id).status, 'awaiting_approval');
  const [open] = gate.pending();
  assert.equal(open.job_id, job.id);
  assert.match(open.reason, /always needs a person/);
});

test('an ordinary job runs with no approval asked for', async () => {
  const { queue, gate, worker, handler } = setup();
  const job = queue.enqueue({ type: 'note.write', payload: { amount: 12, to: 'ali@example.com' } });

  await worker.drain();

  assert.equal(handler.calls.length, 1);
  assert.equal(queue.get(job.id).status, 'completed');
  assert.equal(gate.findByJob(job.id), undefined);
});

test('approving releases the job and it runs exactly once', async () => {
  const { queue, gate, worker, handler } = setup();
  const job = queue.enqueue({ type: 'payment.send', payload: { amount: 4820 } });
  await worker.drain();

  const [open] = gate.pending();
  const result = gate.approve(open.id, 'ali', 'invoice checked');
  assert.equal(result.changed, true);

  await worker.drain();
  assert.equal(handler.calls.length, 1);
  assert.equal(queue.get(job.id).status, 'completed');

  // And draining again does not run it a second time.
  await worker.drain();
  assert.equal(handler.calls.length, 1);
});

test('approving twice is one decision and one run', async () => {
  const { gate, worker, handler } = setup();
  const q = worker.queue;
  q.enqueue({ type: 'payment.send', payload: { amount: 90 } });
  await worker.drain();

  const [open] = gate.pending();
  const first = gate.approve(open.id, 'ali');
  const second = gate.approve(open.id, 'someone-else');

  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(second.approval.decided_by, 'ali');

  await worker.drain();
  assert.equal(handler.calls.length, 1);
});

test('rejecting is terminal: the handler never runs, now or later', async () => {
  const { queue, gate, worker, handler } = setup();
  const job = queue.enqueue({ type: 'payment.send', payload: { amount: 4820 } });
  await worker.drain();

  const [open] = gate.pending();
  gate.reject(open.id, 'ali', 'wrong account');

  await worker.drain();
  await worker.drain();

  assert.equal(handler.calls.length, 0);
  assert.equal(queue.get(job.id).status, 'rejected');
  assert.match(queue.get(job.id).last_error, /rejected by ali/);
  assert.equal(gate.approve(open.id, 'ali').changed, false);
});

test('an unanswered approval expires, and silence does not run the job', async () => {
  const db = openDb(':memory:');
  const queue = new Queue(db);
  const gate = new Gate(db, queue, { ttlMs: 5 });
  const handler = spy();
  const worker = new Worker(db, queue, { 'payment.send': handler.fn }, { gate });

  const job = queue.enqueue({ type: 'payment.send', payload: { amount: 4820 } });
  await worker.drain();
  assert.equal(queue.get(job.id).status, 'awaiting_approval');

  await new Promise(r => setTimeout(r, 20));
  await worker.drain();

  assert.equal(handler.calls.length, 0);
  assert.equal(queue.get(job.id).status, 'expired');
  assert.equal(gate.findByJob(job.id).status, 'expired');
});

test('a held job is still held after a restart, and is asked about only once', async () => {
  const db = openDb(':memory:');
  const queue = new Queue(db);
  const gate = new Gate(db, queue);
  const handler = spy();
  const make = () => new Worker(db, queue, { 'payment.send': handler.fn }, { gate });

  const job = queue.enqueue({ type: 'payment.send', payload: { amount: 4820 } });
  await make().drain();
  await make().drain();   // a fresh worker, as after a restart
  await make().drain();

  assert.equal(handler.calls.length, 0);
  assert.equal(queue.get(job.id).status, 'awaiting_approval');
  assert.equal(gate.pending().length, 1);
  const asked = db.prepare(
    `SELECT COUNT(*) n FROM audit_log WHERE event='approval.requested' AND job_id=?`
  ).get(job.id).n;
  assert.equal(asked, 1);
});

test('a rule change does not re-open a job a person already approved', async () => {
  const db = openDb(':memory:');
  const queue = new Queue(db);
  const gate = new Gate(db, queue, { policy: makePolicy([alwaysHold(['payment.send'])]) });
  const handler = spy();
  const worker = new Worker(db, queue, { 'payment.send': handler.fn }, { gate });

  queue.enqueue({ type: 'payment.send', payload: { amount: 10 } });
  await worker.drain();
  gate.approve(gate.pending()[0].id, 'ali');

  // The rule still matches the job. The recorded decision is what counts.
  await worker.drain();
  assert.equal(handler.calls.length, 1);
});

test('a type can be given a shorter window than the default', async () => {
  const db = openDb(':memory:');
  const queue = new Queue(db);
  const gate = new Gate(db, queue, { ttlMs: 60_000, ttlByType: { 'payment.send': 20 } });
  const worker = new Worker(db, queue, { 'payment.send': async () => {}, 'contract.sign': async () => {} }, { gate });

  const quick = queue.enqueue({ type: 'payment.send', payload: { amount: 10 } });
  const slow = queue.enqueue({ type: 'contract.sign', payload: {} });
  await worker.drain();

  await new Promise((r) => setTimeout(r, 40));
  await worker.drain();

  assert.equal(queue.get(quick.id).status, 'expired');
  assert.equal(queue.get(slow.id).status, 'awaiting_approval');
});
