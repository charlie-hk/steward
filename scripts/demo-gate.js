// The approval gate, end to end. Four jobs go in; two run unattended, two wait
// for a person. Then a person decides, and the consequences are printed.
const path = require('path');
const fs = require('fs');
const { openDb } = require('../src/db');
const { Queue } = require('../src/queue');
const { Worker } = require('../src/worker');
const { Gate } = require('../src/gate');
const { makeEmailConnector } = require('../src/connectors/email');

const dbFile = process.env.STEWARD_DB || path.join(__dirname, '..', 'data', 'gate-demo.db');
fs.mkdirSync(path.dirname(dbFile), { recursive: true });
for (const suffix of ['', '-shm', '-wal']) fs.rmSync(dbFile + suffix, { force: true });

const db = openDb(dbFile);
const queue = new Queue(db);
const gate = new Gate(db, queue);
const email = makeEmailConnector(db);

let paymentsMade = 0;

const handlers = {
  'invoice.sync': async () => {},
  'email.send': async (payload, job) => {
    email.send({ key: `email:${job.id}`, to: payload.to, subject: payload.subject });
  },
  'payment.send': async (payload) => {
    paymentsMade += 1;
    console.log(`    ** money moved: USD ${payload.amount.toFixed(2)} to ${payload.to}`);
  },
};

const worker = new Worker(db, queue, handlers, { gate });

const line = (s) => console.log(`\n${s}\n${'-'.repeat(s.length)}`);
const show = () => {
  for (const job of db.prepare('SELECT * FROM jobs ORDER BY id').all()) {
    const approval = gate.findByJob(job.id);
    const tail = approval ? `  [${approval.status}: ${approval.reason}]` : '';
    console.log(`  #${job.id} ${job.type.padEnd(13)} ${job.status.padEnd(18)}${tail}`);
  }
};

(async () => {
  queue.enqueue({ type: 'invoice.sync', payload: {} });
  queue.enqueue({ type: 'email.send', payload: { to: 'team@example.com', subject: 'Daily summary' } });
  queue.enqueue({ type: 'email.send', payload: { to: 'customer@acme.test', subject: 'Your refund' } });
  queue.enqueue({ type: 'payment.send', payload: { to: 'Acme Ltd', amount: 4820 } });

  line('First pass. Nobody has been asked anything yet.');
  await worker.drain();
  show();

  line('Waiting for a person');
  for (const a of gate.pending()) console.log(`  approval #${a.id} on job #${a.job_id}: ${a.reason}`);

  line('A person approves the refund email and rejects the payment');
  const [refund, payment] = gate.pending();
  console.log(`  approve #${refund.id}: changed=${gate.approve(refund.id, 'ali', 'refund agreed on the call').changed}`);
  console.log(`  approve #${refund.id} again: changed=${gate.approve(refund.id, 'ali').changed}   <- one decision, not two`);
  console.log(`  reject  #${payment.id}: changed=${gate.reject(payment.id, 'ali', 'wrong account number').changed}`);

  line('Second pass');
  await worker.drain();
  await worker.drain();
  show();

  line('What actually happened');
  console.log(`  emails sent:   ${email.count()}`);
  console.log(`  payments made: ${paymentsMade}`);
  console.log('\n  audit log:');
  for (const row of db.prepare('SELECT * FROM audit_log ORDER BY id').all()) {
    console.log(`    ${String(row.job_id ?? '-').padStart(2)}  ${row.event.padEnd(20)} ${row.detail ?? ''}`);
  }
  console.log(`\n  db left at ${path.relative(process.cwd(), dbFile)} - try: node scripts/review.js list --db data/gate-demo.db\n`);
})();
