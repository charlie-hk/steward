// The numbers printed on the cover image, produced by a real run that
// includes a crash and a restart. If the cover says five executed and zero
// duplicates, this is where that came from.
const path = require('path');
const fs = require('fs');
const { createSteward } = require('../src/steward');
const { addDocument } = require('../src/ai/retrieve');

const dbFile = process.env.STEWARD_DB || path.join(__dirname, '..', 'data', 'figures.db');
fs.mkdirSync(path.dirname(dbFile), { recursive: true });
for (const suffix of ['', '-shm', '-wal']) fs.rmSync(dbFile + suffix, { force: true });

const steward = createSteward({ dbFile, quiet: true });
const { db, queue, gate, worker, connectors } = steward;

(async () => {
  addDocument(db, { kind: 'policy', subject: 'Invoices', body: 'A corrected invoice is reissued within two working days.' });

  queue.enqueue({ type: 'crm.contact.upsert', payload: { key: 'crm:dana', email: 'dana@acme.test', name: 'Dana' } });
  queue.enqueue({ type: 'invoice.create', payload: { key: 'inv:1041', customer: 'Acme', amount: 280 } });
  queue.enqueue({ type: 'email.send', payload: { to: 'team@example.com', subject: 'Daily summary' } });
  queue.enqueue({ type: 'reply.draft', payload: { from: 'dana@acme.test', topic: 'invoices', question: 'The invoice amount is wrong.' } });
  await worker.drain();

  // The crash: the same invoice is queued again, claimed with a one-millisecond
  // lease, and the side effect happens without the job ever being completed.
  queue.enqueue({ type: 'invoice.create', payload: { key: 'inv:1041', customer: 'Acme', amount: 280 } });
  queue.claim(1);
  connectors.invoicing.create({ key: 'inv:1041', customer: 'Acme', amount: 280 });
  await new Promise((r) => setTimeout(r, 5));
  await worker.drain();   // the restart: the lease has expired, the job reruns

  queue.enqueue({ type: 'payment.send', payload: { to: 'Acme Ltd', amount: 4820 } });
  await worker.drain();

  console.log(JSON.stringify({
    executed: queue.counts().completed,
    invoicesIssued: connectors.invoicing.count(),
    duplicatesAfterRestart: connectors.invoicing.count() - 1,
    waitingForAPerson: gate.pending().length,
  }, null, 2));
  db.close();
})();
