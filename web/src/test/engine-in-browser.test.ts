// @vitest-environment node
import { describe, expect, test } from 'vitest';
import initSqlJs from 'sql.js';
import { wrapSqlJs, type SqliteLike } from '../engine/sqljs';

// The claim this file exists to check: the engine from ../../src runs
// unmodified against SQLite compiled to WebAssembly. If the adapter is wrong,
// the demo on GitHub Pages is a lie, and these tests are what stop that.

const { migrate } = require('../../../src/db');
const { Queue } = require('../../../src/queue');
const { Worker } = require('../../../src/worker');
const { Gate } = require('../../../src/gate');
const { makeInvoicingConnector } = require('../../../src/connectors/invoicing');

async function freshDb(): Promise<SqliteLike> {
  const SQL = await initSqlJs();
  const db = wrapSqlJs(new SQL.Database());
  migrate(db);
  return db;
}

describe('the sql.js adapter', () => {
  test('reports changes and the last inserted id the way better-sqlite3 does', async () => {
    const db = await freshDb();
    const insert = db.prepare('INSERT INTO documents (kind, subject, body, created_at) VALUES (?,?,?,?)');
    const first = insert.run('policy', 'Refunds', 'five working days', Date.now());
    const second = insert.run('policy', 'Invoices', 'two working days', Date.now());

    expect(first.changes).toBe(1);
    expect(second.lastInsertRowid).toBe(first.lastInsertRowid + 1);
    expect(db.prepare('SELECT COUNT(*) n FROM documents').get()).toEqual({ n: 2 });
    expect(db.prepare('SELECT * FROM documents').all()).toHaveLength(2);
    expect(db.prepare('SELECT * FROM documents WHERE id = 99').get()).toBeUndefined();
  });

  test('a transaction that throws leaves nothing behind', async () => {
    const db = await freshDb();
    const boom = db.transaction(() => {
      db.prepare('INSERT INTO documents (kind, subject, body, created_at) VALUES (?,?,?,?)')
        .run('policy', 'Half', 'written', Date.now());
      throw new Error('no');
    });
    expect(boom).toThrow('no');
    expect(db.prepare('SELECT COUNT(*) n FROM documents').get()).toEqual({ n: 0 });
  });
});

describe('the engine, on WebAssembly SQLite', () => {
  test('holds a payment, runs it once on approval, and never on rejection', async () => {
    const db = await freshDb();
    const queue = new Queue(db);
    const gate = new Gate(db, queue);
    const paid: number[] = [];
    const worker = new Worker(db, queue, {
      'payment.send': async (payload: { amount: number }) => { paid.push(payload.amount); },
    }, { gate });

    const approved = queue.enqueue({ type: 'payment.send', payload: { amount: 4820 } });
    await worker.drain();

    expect(paid).toHaveLength(0);
    expect(queue.get(approved.id).status).toBe('awaiting_approval');

    const waiting = gate.pending();
    expect(waiting).toHaveLength(1);
    expect(gate.approve(waiting[0].id, 'ali').changed).toBe(true);
    expect(gate.approve(waiting[0].id, 'sam').changed).toBe(false);

    await worker.drain();
    await worker.drain();
    expect(paid).toEqual([4820]);
    expect(queue.get(approved.id).status).toBe('completed');
  });

  test('a crash mid-job does not issue the invoice twice', async () => {
    const db = await freshDb();
    const queue = new Queue(db);
    const invoicing = makeInvoicingConnector(db);
    const key = 'inv:1041';

    queue.enqueue({ type: 'invoice.create', payload: { key }, maxAttempts: 5 });
    const job = queue.claim(1);
    invoicing.create({ key, customer: 'Acme', amount: 95 });     // the side effect happened
    await new Promise((r) => setTimeout(r, 5));                  // the worker died; the lease expires

    const worker = new Worker(db, queue, {
      'invoice.create': async (payload: { key: string }) => {
        invoicing.create({ key: payload.key, customer: 'Acme', amount: 95 });
      },
    });
    await worker.drain();

    expect(invoicing.count()).toBe(1);
    expect(queue.get(job.id).status).toBe('completed');
  });

  test('the idempotency key survives the round trip through WebAssembly', async () => {
    const db = await freshDb();
    const queue = new Queue(db);
    const a = queue.enqueue({ type: 'noop', idempotencyKey: 'order-42' });
    const b = queue.enqueue({ type: 'noop', idempotencyKey: 'order-42' });
    expect(b.id).toBe(a.id);
    expect(db.prepare('SELECT COUNT(*) n FROM jobs').get()).toEqual({ n: 1 });
  });
});
