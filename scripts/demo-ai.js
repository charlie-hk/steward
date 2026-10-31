// The AI layer end to end: retrieve, draft, hold, decide, learn.
//
// Nothing here needs an API key. The model is the mock adapter, so what you
// are watching is the plumbing: what the model was shown, what it wrote, and
// the fact that none of it left the building without a person saying yes.
const path = require('path');
const fs = require('fs');
const { createSteward } = require('../src/steward');
const { addDocument } = require('../src/ai/retrieve');
const { approvedExamples } = require('../src/ai/examples');
const { buildTrainingSet } = require('../src/ai/training');

const dbFile = process.env.STEWARD_DB || path.join(__dirname, '..', 'data', 'ai-demo.db');
fs.mkdirSync(path.dirname(dbFile), { recursive: true });
for (const suffix of ['', '-shm', '-wal']) fs.rmSync(dbFile + suffix, { force: true });

const { db, queue, gate, worker, connectors } = createSteward({ dbFile, quiet: true });

const line = (s) => console.log(`\n${s}\n${'-'.repeat(s.length)}`);

(async () => {
  line('What the system knows (the retrieval corpus)');
  for (const doc of [
    { kind: 'policy', subject: 'Refunds', body: 'Refunds are issued to the original card within five working days.' },
    { kind: 'policy', subject: 'Invoices', body: 'A corrected invoice is reissued within two working days of a dispute.' },
    { kind: 'policy', subject: 'Shipping', body: 'Orders leave the warehouse the next working day.' },
  ]) {
    addDocument(db, doc);
    console.log(`  ${doc.subject.padEnd(10)} ${doc.body}`);
  }

  line('A customer writes in about an invoice');
  queue.enqueue({
    type: 'reply.draft',
    payload: { from: 'dana@acme.test', topic: 'invoices', question: 'The invoice I received has the wrong amount on it. When will I get a corrected one?' },
    idempotencyKey: 'ticket-1',
  });
  await worker.drain();

  const [waiting] = gate.pending();
  const draft = db.prepare('SELECT * FROM drafts WHERE job_id = ?').get(waiting.job_id);
  console.log(`  held: ${waiting.reason}`);
  console.log(`  model: ${draft.model}   retrieved: ${JSON.parse(draft.sources).join(', ') || 'nothing'}`);
  console.log('\n  the draft a person is being asked about:\n');
  console.log(draft.body.split('\n').map((l) => `    ${l}`).join('\n'));
  console.log(`\n  emails to the customer: ${connectors.email.count()}   <- the model wrote, it did not send`);
  console.log(`  alerts to the operator:  ${connectors.email.alertCount()}   <- somebody was told it is waiting`);

  line('A person approves it');
  gate.approve(waiting.id, 'ali', 'fine, matches our policy');
  await worker.drain();
  console.log(`  emails to the customer: ${connectors.email.count()}`);

  line('A second customer, same topic. The approved reply is now an example.');
  queue.enqueue({
    type: 'reply.draft',
    payload: { from: 'sam@beta.test', topic: 'invoices', question: 'My invoice total looks wrong, can you fix it?' },
    idempotencyKey: 'ticket-2',
  });
  await worker.drain();
  const second = gate.pending()[0];
  const secondDraft = db.prepare('SELECT * FROM drafts WHERE job_id = ?').get(second.job_id);
  console.log(`  examples shown to the model: ${approvedExamples(db, { topic: 'invoices' }).length}`);
  console.log(`  prompt now contains an approved reply: ${secondDraft.prompt.includes('REPLIES A PERSON ALREADY APPROVED')}`);
  gate.reject(second.id, 'ali', 'too terse for a second complaint from the same account');
  await worker.drain();
  console.log(`  rejected, so emails to customers is still ${connectors.email.count()}`);

  line('The other connectors, for completeness');
  queue.enqueue({ type: 'crm.contact.upsert', payload: { key: 'crm:dana', email: 'dana@acme.test', name: 'Dana', company: 'Acme' } });
  queue.enqueue({ type: 'invoice.create', payload: { key: 'inv:1001', customer: 'Acme', amount: 420.5 } });
  queue.enqueue({ type: 'invoice.create', payload: { key: 'inv:1001', customer: 'Acme', amount: 420.5 } });
  await worker.drain();
  console.log(`  crm contacts: ${connectors.crm.count()}   invoices: ${connectors.invoicing.count()} (two jobs, one invoice)`);

  line('Stage four: the training file');
  const set = buildTrainingSet(db);
  console.log(`  approved drafts available: ${set.count}`);
  console.log(`  enough to fine-tune on: ${set.enough} (needs ${set.minimum})`);

  console.log(`\n  db left at ${path.relative(process.cwd(), dbFile)}`);
  console.log('  see it in a browser:  npm start -- --db ' + path.relative(process.cwd(), dbFile) + '\n');
  db.close();
})();
