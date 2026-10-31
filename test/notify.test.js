const { test } = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { Queue } = require('../src/queue');
const { Worker } = require('../src/worker');
const { Gate } = require('../src/gate');
const { fanout } = require('../src/notify');

function counting() {
  const seen = [];
  return { notifier: { notify: (e) => seen.push(e) }, seen };
}

test('a held job alerts a person once, however many times it is claimed', async () => {
  const db = openDb(':memory:');
  const queue = new Queue(db);
  const { notifier, seen } = counting();
  const gate = new Gate(db, queue, { notifier });
  const worker = new Worker(db, queue, { 'payment.send': async () => {} }, { gate });

  queue.enqueue({ type: 'payment.send', payload: { amount: 4820 } });
  await worker.drain();
  await worker.drain();
  await worker.drain();

  assert.equal(seen.length, 1);
  assert.equal(seen[0].job.type, 'payment.send');
  assert.match(seen[0].approval.reason, /needs a person/);
});

test('a notifier that throws does not break the job or lose the approval', async () => {
  const db = openDb(':memory:');
  const queue = new Queue(db);
  const angry = { notify() { throw new Error('pager is down'); } };
  const gate = new Gate(db, queue, { notifier: angry });
  const worker = new Worker(db, queue, { 'payment.send': async () => {} }, { gate });

  const job = queue.enqueue({ type: 'payment.send', payload: { amount: 10 } });
  await worker.drain();

  assert.equal(queue.get(job.id).status, 'awaiting_approval');
  assert.equal(gate.pending().length, 1);
  const logged = db.prepare(`SELECT COUNT(*) n FROM audit_log WHERE event='notify.failed'`).get().n;
  assert.equal(logged, 1);
});

test('fanout keeps going when one channel fails', () => {
  const calls = [];
  const notifier = fanout([
    { notify: () => { throw new Error('down'); } },
    { notify: () => calls.push('second') },
  ]);
  notifier.notify({});
  assert.deepEqual(calls, ['second']);
});
