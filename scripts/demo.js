// A tiny end-to-end run you can watch: enqueue two jobs, process them, print the queue.
const path = require('path');
const fs = require('fs');
const { openDb } = require('../src/db');
const { Queue } = require('../src/queue');
const { Worker } = require('../src/worker');
const { makeEmailConnector } = require('../src/connectors/email');

const dbFile = path.join(__dirname, '..', 'data', 'demo.db');
fs.mkdirSync(path.dirname(dbFile), { recursive: true });
fs.rmSync(dbFile, { force: true });

const db = openDb(dbFile);
const queue = new Queue(db);
const email = makeEmailConnector(db);

const handlers = {
  'welcome-email': async (payload, job) => {
    const r = email.send({ key: `welcome:${job.id}`, to: payload.to, subject: 'Welcome' });
    console.log(`  sent welcome to ${payload.to} (new=${r.sent})`);
  },
};

queue.enqueue({ type: 'welcome-email', payload: { to: 'ali@example.com' }, idempotencyKey: 'signup-1' });
queue.enqueue({ type: 'welcome-email', payload: { to: 'ali@example.com' }, idempotencyKey: 'signup-1' }); // duplicate, ignored

(async () => {
  const worker = new Worker(db, queue, handlers);
  const processed = await worker.drain();
  console.log(`processed ${processed} job(s)`);
  console.log('queue:', queue.counts());
  console.log('emails sent:', email.count());
})();
