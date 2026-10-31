const { test } = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { Queue } = require('../src/queue');
const { Worker } = require('../src/worker');
const { Runner } = require('../src/runner');

test('the runner keeps working without being asked again', async () => {
  const db = openDb(':memory:');
  const queue = new Queue(db);
  const done = [];
  const runner = new Runner(new Worker(db, queue, { noop: async (p) => done.push(p.n) }), { pollMs: 5 });

  runner.start();
  queue.enqueue({ type: 'noop', payload: { n: 1 } });
  await new Promise((r) => setTimeout(r, 40));
  // Enqueued while it is already running: nobody called drain for this one.
  queue.enqueue({ type: 'noop', payload: { n: 2 } });
  await new Promise((r) => setTimeout(r, 40));
  await runner.stop();

  assert.deepEqual(done.sort(), [1, 2]);
});

test('stopping waits for the job in flight instead of abandoning it', async () => {
  const db = openDb(':memory:');
  const queue = new Queue(db);
  let finished = false;
  const slow = async () => {
    await new Promise((r) => setTimeout(r, 60));
    finished = true;
  };
  const runner = new Runner(new Worker(db, queue, { slow }), { pollMs: 5 });

  const job = queue.enqueue({ type: 'slow' });
  runner.start();
  await new Promise((r) => setTimeout(r, 15));   // let it claim the job
  await runner.stop();

  assert.equal(finished, true);
  assert.equal(queue.get(job.id).status, 'completed');
  assert.equal(queue.get(job.id).lease_until, null);
});

test('a stopped runner takes no further work', async () => {
  const db = openDb(':memory:');
  const queue = new Queue(db);
  const done = [];
  const runner = new Runner(new Worker(db, queue, { noop: async () => done.push(1) }), { pollMs: 5 });

  runner.start();
  await new Promise((r) => setTimeout(r, 20));
  await runner.stop();

  queue.enqueue({ type: 'noop' });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(done.length, 0);
  assert.equal(queue.counts().pending, 1);
});
