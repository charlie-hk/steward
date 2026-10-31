import { openBrowserDb, type SqliteLike } from '../engine/sqljs';
import { migrate } from '@engine/db';
import { Queue } from '@engine/queue';
import { Worker } from '@engine/worker';
import { Gate } from '@engine/gate';
import { makePolicy } from '@engine/policy';
import { fanout, emailNotifier } from '@engine/notify';
import { makeEmailConnector } from '@engine/connectors/email';
import { makeCrmConnector } from '@engine/connectors/crm';
import { makeInvoicingConnector } from '@engine/connectors/invoicing';
import { mockModel } from '@engine/ai/model';
import { makeDraftHandler, makeSendHandler } from '@engine/ai/draft';
import { scenarios as allScenarios, byKey } from '@engine/scenarios';
import type { Approval, DecisionResult, Job, Snapshot, StewardApi } from './types';

/**
 * The engine, in the tab.
 *
 * Every import above except the database itself is the same file the service
 * runs: the same queue, the same gate, the same policy, the same drafting
 * step. The database is SQLite compiled to WebAssembly instead of the native
 * driver, which is the only difference between this and a running service.
 *
 * It matters because a hand-written mock of an approval gate always agrees
 * with whatever the person writing the demo believed. This one does not: if
 * the rules change, the demo changes with them, and if the engine is wrong,
 * the demo is wrong in the same way.
 */
export async function browserApi(): Promise<StewardApi> {
  let state = await build();

  async function build() {
    const db = await openBrowserDb();
    migrate(db);

    const queue = new Queue(db);
    const email = makeEmailConnector(db);
    const crm = makeCrmConnector(db);
    const invoicing = makeInvoicingConnector(db);
    const connectors = { email, crm, invoicing };

    const gate = new Gate(db, queue, {
      policy: makePolicy(),
      ttlByType: { 'contract.sign': 10_000 },
      notifier: fanout([emailNotifier(email, 'ops@example.com')]),
    });

    const model = mockModel();
    const handlers = {
      'reply.draft': makeDraftHandler({ db, queue, model }),
      'reply.send': makeSendHandler({ db, email }),
      'email.send': async (payload: { to: string; subject?: string }, job: { id: number }) =>
        void email.send({ key: `email:${job.id}`, to: payload.to, subject: payload.subject }),
      'crm.contact.upsert': async (payload: Record<string, unknown>, job: { id: number }) =>
        void crm.upsertContact({ key: (payload.key as string) || `crm:${job.id}`, ...payload }),
      'invoice.create': async (payload: Record<string, unknown>, job: { id: number }) =>
        void invoicing.create({ key: (payload.key as string) || `invoice:${job.id}`, ...payload }),
      'payment.send': async (payload: { amount: number }) => ({ paid: payload.amount }),
      'contract.sign': async (payload: { counterparty: string }) => ({ signed: payload.counterparty }),
      flaky: async () => { throw new Error('the upstream system said no'); },
    } as unknown as Record<string, (payload: never, job: never) => Promise<unknown>>;

    const worker = new Worker(db, queue, handlers, { gate });
    return { db: db as SqliteLike, queue, gate, worker, connectors };
  }

  // The service has a runner polling in a loop; here the tab does it, so the
  // demo keeps moving on its own: retries come due, approvals expire, released
  // jobs run without anyone pressing anything.
  const tick = async () => {
    try { await state.worker.drain(); } catch { /* a broken cycle must not stop the loop */ }
  };
  setInterval(tick, 700);

  const one = <T>(sql: string, fallback: T): T => {
    const row = state.db.prepare(sql).get() as Record<string, T> | undefined;
    return row ? Object.values(row)[0] : fallback;
  };

  return {
    mode: 'browser',

    async snapshot(): Promise<Snapshot> {
      await tick();
      state.gate.expireOverdue();

      const jobs = state.db.prepare('SELECT * FROM jobs ORDER BY id DESC LIMIT 100').all() as unknown as Job[];
      const approvals = (state.gate.pending() as unknown as (Approval & { payload: string })[]).map((row) => ({
        ...row,
        payload: safeJson(row.payload),
        draft: (state.db
          .prepare('SELECT body, model, topic, sources FROM drafts WHERE job_id = ?')
          .get(row.job_id) ?? null) as Approval['draft'],
      }));

      return {
        summary: {
          jobs: state.queue.counts(),
          waiting: approvals.length,
          emails: one<number>("SELECT COUNT(*) n FROM sent_emails WHERE kind = 'mail'", 0),
          alerts: one<number>("SELECT COUNT(*) n FROM sent_emails WHERE kind = 'alert'", 0),
          invoices: state.connectors.invoicing.count(),
        },
        approvals,
        jobs: jobs.map((job) => ({ ...job, payload: safeJson(job.payload as unknown as string) })),
        audit: state.db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 200').all() as unknown as Snapshot['audit'],
      };
    },

    async scenarios() {
      return allScenarios.map(({ key, title, blurb, expect }) => ({ key, title, blurb, expect }));
    },

    async runScenario(key: string) {
      const scenario = byKey[key];
      if (!scenario) throw new Error(`no scenario "${key}"`);
      await scenario.run(state as unknown as Record<string, unknown>);
      await tick();
    },

    async decide(id, action, by, note): Promise<DecisionResult> {
      const result = action === 'approve'
        ? state.gate.approve(id, by, note)
        : state.gate.reject(id, by, note);

      if (!result.approval) return { ok: false, conflict: false, error: `no approval #${id}` };
      if (!result.changed) {
        return { ok: false, conflict: true, status: result.approval.status, by: result.approval.decided_by };
      }
      await tick();
      return { ok: true };
    },

    async reset() {
      state.db.close();
      state = await build();
    },
  };
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return text; }
}
