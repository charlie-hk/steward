const { test } = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { makeCrmConnector } = require('../src/connectors/crm');
const { makeInvoicingConnector } = require('../src/connectors/invoicing');

test('a CRM contact is upserted, not duplicated', () => {
  const crm = makeCrmConnector(openDb(':memory:'));
  const first = crm.upsertContact({ key: 'crm:dana', email: 'dana@acme.test', name: 'Dana' });
  const again = crm.upsertContact({ key: 'crm:dana', email: 'dana@acme.test', name: 'Dana Ruiz' });

  assert.equal(first.created, true);
  assert.equal(again.created, false);
  assert.equal(crm.count(), 1);
  assert.equal(crm.get('crm:dana').name, 'Dana Ruiz');
});

test('the same invoice is issued once, at the amount it was issued at', () => {
  const invoicing = makeInvoicingConnector(openDb(':memory:'));
  const first = invoicing.create({ key: 'inv:1001', customer: 'Acme', amount: 420.5 });
  const again = invoicing.create({ key: 'inv:1001', customer: 'Acme', amount: 999 });

  assert.equal(first.created, true);
  assert.equal(again.duplicate, true);
  assert.equal(invoicing.count(), 1);
  assert.equal(again.invoice.amount_cents, 42050);
  assert.equal(invoicing.total(), 420.5);
});

test('an invoice with a nonsense amount is refused rather than stored', () => {
  const invoicing = makeInvoicingConnector(openDb(':memory:'));
  assert.throws(() => invoicing.create({ key: 'inv:x', customer: 'Acme', amount: 'later' }), /invalid amount/);
  assert.equal(invoicing.count(), 0);
});
