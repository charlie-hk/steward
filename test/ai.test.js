const { test } = require('node:test');
const assert = require('node:assert');
const { createSteward } = require('../src/steward');
const { addDocument, retrieve } = require('../src/ai/retrieve');
const { approvedExamples } = require('../src/ai/examples');
const { buildTrainingSet } = require('../src/ai/training');

function seed(db) {
  addDocument(db, { kind: 'policy', subject: 'Refunds', body: 'Refunds reach the original card within five working days.' });
  addDocument(db, { kind: 'policy', subject: 'Invoices', body: 'A corrected invoice is reissued within two working days.' });
  addDocument(db, { kind: 'policy', subject: 'Shipping', body: 'Orders leave the warehouse the next working day.' });
}

// A model that records what it was asked, so the tests can check the prompt
// rather than the prose.
function recorder(reply = 'Drafted reply.') {
  const prompts = [];
  return { prompts, model: { name: 'recorder', async complete({ prompt }) { prompts.push(prompt); return reply; } } };
}

test('retrieval prefers the document that shares the rare words', () => {
  const { db } = createSteward({ quiet: true });
  seed(db);
  const hits = retrieve(db, 'my invoice total is wrong, when is it corrected?');
  assert.equal(hits[0].subject, 'Invoices');
  assert.ok(hits[0].score > 0);
});

test('retrieval returns nothing rather than a bad guess when nothing matches', () => {
  const { db } = createSteward({ quiet: true });
  seed(db);
  assert.deepEqual(retrieve(db, 'zebra telescope'), []);
});

test('a drafted reply is held, and nothing is sent until a person approves', async () => {
  const { prompts, model } = recorder();
  const { db, queue, gate, worker, connectors } = createSteward({ quiet: true, model });
  seed(db);

  queue.enqueue({ type: 'reply.draft', payload: { from: 'dana@acme.test', topic: 'invoices', question: 'The invoice amount is wrong.' } });
  await worker.drain();

  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /A corrected invoice is reissued/);   // retrieval reached the model
  assert.equal(connectors.email.count(), 0);                     // and nothing went out

  const [waiting] = gate.pending();
  const draft = db.prepare('SELECT * FROM drafts WHERE job_id = ?').get(waiting.job_id);
  assert.equal(draft.body, 'Drafted reply.');

  gate.approve(waiting.id, 'ali');
  await worker.drain();

  const sent = connectors.email.all().filter((m) => m.kind === 'mail');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].recipient, 'dana@acme.test');
  assert.equal(sent[0].body, 'Drafted reply.');   // what went out is what was reviewed
});

test('an approved reply becomes an example in the next prompt; a rejected one becomes a warning', async () => {
  const { prompts, model } = recorder('First reply.');
  const { db, queue, gate, worker } = createSteward({ quiet: true, model });
  seed(db);

  queue.enqueue({ type: 'reply.draft', payload: { from: 'a@acme.test', topic: 'invoices', question: 'Invoice wrong.' }, idempotencyKey: 't1' });
  await worker.drain();
  gate.approve(gate.pending()[0].id, 'ali');
  await worker.drain();

  queue.enqueue({ type: 'reply.draft', payload: { from: 'b@beta.test', topic: 'invoices', question: 'Invoice wrong too.' }, idempotencyKey: 't2' });
  await worker.drain();

  assert.equal(approvedExamples(db, { topic: 'invoices' }).length, 1);
  assert.match(prompts[1], /REPLIES A PERSON ALREADY APPROVED/);
  assert.match(prompts[1], /First reply\./);

  gate.reject(gate.pending()[0].id, 'ali', 'too terse');
  await worker.drain();

  queue.enqueue({ type: 'reply.draft', payload: { from: 'c@beta.test', topic: 'invoices', question: 'And mine.' }, idempotencyKey: 't3' });
  await worker.drain();
  assert.match(prompts[2], /WHAT A REVIEWER TURNED DOWN BEFORE/);
  assert.match(prompts[2], /too terse/);
});

test('a rerun of the drafting job does not queue a second reply to the same person', async () => {
  const { model } = recorder();
  const { db, queue, worker } = createSteward({ quiet: true, model });
  seed(db);

  const job = queue.enqueue({ type: 'reply.draft', payload: { from: 'dana@acme.test', topic: 'invoices', question: 'Wrong amount.' } });
  await worker.drain();
  // Force the drafting job to run again, as a crash recovery would.
  queue.release(job.id);
  await worker.drain();

  assert.equal(db.prepare("SELECT COUNT(*) n FROM jobs WHERE type='reply.send'").get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM drafts').get().n, 1);
});

test('the training export refuses a set too small to be worth anything', async () => {
  const { model } = recorder();
  const { db, queue, gate, worker } = createSteward({ quiet: true, model });
  seed(db);

  queue.enqueue({ type: 'reply.draft', payload: { from: 'dana@acme.test', topic: 'invoices', question: 'Wrong.' } });
  await worker.drain();
  gate.approve(gate.pending()[0].id, 'ali');
  await worker.drain();

  const small = buildTrainingSet(db);
  assert.equal(small.count, 1);
  assert.equal(small.enough, false);

  const ok = buildTrainingSet(db, { minimum: 1 });
  assert.equal(ok.enough, true);
  const line = JSON.parse(ok.jsonl.split('\n')[0]);
  assert.equal(line.messages.length, 3);
  assert.equal(line.messages[2].role, 'assistant');
  assert.equal(line.messages[2].content, 'Drafted reply.');
});
