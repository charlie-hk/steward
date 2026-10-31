const { addDocument } = require('./ai/retrieve');

// Situations worth watching, defined once and used by both the HTTP API and
// the browser build, so the demo in a tab and the service on a machine cannot
// tell different stories.

function seedKnowledge(db) {
  const already = db.prepare('SELECT COUNT(*) n FROM documents').get().n;
  if (already > 0) return;
  for (const doc of [
    { kind: 'policy', subject: 'Refunds', body: 'Refunds reach the original card within five working days.' },
    { kind: 'policy', subject: 'Invoices', body: 'A corrected invoice is reissued within two working days of a dispute.' },
    { kind: 'policy', subject: 'Shipping', body: 'Orders leave the warehouse the next working day.' },
    { kind: 'account', subject: 'Acme Ltd', body: 'On net-30 terms since 2024. Two disputed invoices, both resolved.' },
  ]) addDocument(db, doc);
}

const scenarios = [
  {
    key: 'ordinary',
    title: 'Ordinary work',
    blurb: 'A contact update and an internal email. No rule matches, so nobody is asked.',
    expect: 'Both run unattended and finish.',
    run({ queue }) {
      queue.enqueue({ type: 'crm.contact.upsert', payload: { key: `crm:${Date.now()}`, email: 'dana@acme.test', name: 'Dana Ruiz', company: 'Acme Ltd' } });
      queue.enqueue({ type: 'email.send', payload: { to: 'team@example.com', subject: 'Daily summary' } });
    },
  },
  {
    key: 'payment',
    title: 'A payment',
    blurb: 'USD 4,820.00 to a supplier.',
    expect: 'Held. It moves money, so it waits for a person.',
    run({ queue }) {
      queue.enqueue({ type: 'payment.send', payload: { to: 'Acme Ltd', amount: 4820, reference: 'INV-1041' } });
    },
  },
  {
    key: 'invoice-over-limit',
    title: 'An invoice over the limit',
    blurb: 'Two invoices: one for USD 180.00, one for USD 2,400.00.',
    expect: 'The small one is issued. The large one is held by the amount rule.',
    run({ queue }) {
      const stamp = Date.now();
      queue.enqueue({ type: 'invoice.create', payload: { key: `inv:${stamp}:a`, customer: 'Beta GmbH', amount: 180 } });
      queue.enqueue({ type: 'invoice.create', payload: { key: `inv:${stamp}:b`, customer: 'Acme Ltd', amount: 2400 } });
    },
  },
  {
    key: 'draft',
    title: 'A reply written by the model',
    blurb: 'A customer asks about a wrong invoice. The step retrieves what is on file, then drafts.',
    expect: 'Held, with the draft and its sources attached. The model proposes; it cannot send.',
    run({ db, queue }) {
      seedKnowledge(db);
      queue.enqueue({
        type: 'reply.draft',
        payload: { from: 'dana@acme.test', topic: 'invoices', question: 'The invoice I received has the wrong amount on it. When do I get a corrected one?' },
        idempotencyKey: `ticket:${Date.now()}`,
      });
    },
  },
  {
    key: 'crash',
    title: 'A crash mid-job',
    blurb: 'An invoice is issued, then the worker dies before the job is marked done. Its lease expires and another worker picks it up.',
    expect: 'The job completes and the invoice exists exactly once.',
    async run({ queue, worker, connectors }) {
      const key = `inv:crash:${Date.now()}`;
      queue.enqueue({ type: 'invoice.create', payload: { key, customer: 'Acme Ltd', amount: 95 } });
      const job = queue.claim(1);                                    // leased for one millisecond
      connectors.invoicing.create({ key, customer: 'Acme Ltd', amount: 95 });  // the side effect happened
      await new Promise((r) => setTimeout(r, 10));                   // the worker never came back
      await worker.drain();                                          // a fresh one recovers the job
      return { recoveredJob: job?.id ?? null, invoices: connectors.invoicing.count() };
    },
  },
  {
    key: 'retry',
    title: 'Something that keeps failing',
    blurb: 'A job whose handler throws every time, with three attempts allowed.',
    expect: 'Retried with a growing delay, then failed for good. No human is asked: nothing failed a rule, it just broke.',
    run({ queue }) {
      queue.enqueue({ type: 'flaky', payload: { note: 'this one never works' }, maxAttempts: 3 });
    },
  },
  {
    key: 'expire',
    title: 'An approval nobody answers',
    blurb: 'A contract to sign, with a ten-second window instead of a day.',
    expect: 'After ten seconds it expires and the job stops. Silence is not consent.',
    run({ queue, gate }) {
      const job = queue.enqueue({ type: 'contract.sign', payload: { counterparty: 'Beta GmbH', term: '24 months' } });
      return { job: job.id, ttlMs: gate.ttlMs };
    },
  },
];

const byKey = Object.fromEntries(scenarios.map((s) => [s.key, s]));

module.exports = { scenarios, byKey, seedKnowledge };
