const { openDb } = require('./db');
const { Queue } = require('./queue');
const { Worker } = require('./worker');
const { Gate } = require('./gate');
const { Runner } = require('./runner');
const { makePolicy } = require('./policy');
const { consoleNotifier, emailNotifier, fanout } = require('./notify');
const { makeEmailConnector } = require('./connectors/email');
const { makeCrmConnector } = require('./connectors/crm');
const { makeInvoicingConnector } = require('./connectors/invoicing');
const { makeModel } = require('./ai/model');
const { makeDraftHandler, makeSendHandler } = require('./ai/draft');

// One place that wires the parts together, so the service, the demos and the
// tests all run the same system rather than three similar ones.
function createSteward({
  dbFile = ':memory:',
  model = makeModel(),
  policy = makePolicy(),
  alertTo = 'ops@example.com',
  quiet = false,
  pollMs = 500,
  ttlMs,
  ttlByType = { 'contract.sign': 10000 },
} = {}) {
  const db = openDb(dbFile);
  const queue = new Queue(db);

  const email = makeEmailConnector(db);
  const crm = makeCrmConnector(db);
  const invoicing = makeInvoicingConnector(db);

  const notifier = fanout([
    quiet ? { notify() {} } : consoleNotifier(),
    emailNotifier(email, alertTo),
  ]);

  const gate = new Gate(db, queue, { policy, notifier, ttlByType, ...(ttlMs ? { ttlMs } : {}) });

  const handlers = {
    'reply.draft': makeDraftHandler({ db, queue, model }),
    'reply.send': makeSendHandler({ db, email }),
    'email.send': async (payload, job) =>
      void email.send({ key: `email:${job.id}`, to: payload.to, subject: payload.subject, body: payload.body }),
    'crm.contact.upsert': async (payload, job) =>
      void crm.upsertContact({ key: payload.key || `crm:${job.id}`, ...payload }),
    'invoice.create': async (payload, job) =>
      void invoicing.create({ key: payload.key || `invoice:${job.id}`, ...payload }),
    // Used by the "something that keeps failing" scenario: a handler that
    // always throws, to show retry and the terminal failed state.
    flaky: async () => { throw new Error('the upstream system said no'); },
    'contract.sign': async (payload) => ({ signed: payload.counterparty }),
    'payment.send': async (payload) => {
      if (!Number.isFinite(Number(payload.amount))) throw new Error('payment without an amount');
      // A stand-in for a bank. The point of the project is that nothing
      // reaches this line without a recorded human decision.
      return { paid: Number(payload.amount), to: payload.to };
    },
  };

  const worker = new Worker(db, queue, handlers, { gate });
  const runner = new Runner(worker, { pollMs });

  return { db, queue, gate, worker, runner, handlers, model, connectors: { email, crm, invoicing } };
}

module.exports = { createSteward };
