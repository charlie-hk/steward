// The engine is plain JavaScript written for Node. These declarations are the
// surface the browser build uses; they are deliberately narrow.
declare module '@engine/db' {
  export function migrate(db: unknown): void;
}
declare module '@engine/queue' {
  export class Queue {
    constructor(db: unknown);
    enqueue(spec: { type: string; payload?: unknown; idempotencyKey?: string | null; maxAttempts?: number; runAt?: number }): JobRow;
    get(id: number): JobRow | undefined;
    claim(leaseMs: number): JobRow | null;
    hold(id: number): void;
    release(id: number): void;
    halt(id: number, status: string, reason: string): void;
    recoverExpiredLeases(): number;
    counts(): Record<string, number>;
  }
  export interface JobRow {
    id: number; type: string; payload: string; status: string;
    attempts: number; max_attempts: number; last_error: string | null;
    created_at: number; updated_at: number; next_run_at: number; lease_until: number | null;
  }
}
declare module '@engine/worker' {
  export class Worker {
    constructor(db: unknown, queue: unknown, handlers: Record<string, (payload: never, job: never) => Promise<unknown>>, options?: { leaseMs?: number; gate?: unknown });
    tick(): Promise<boolean>;
    drain(): Promise<number>;
  }
}
declare module '@engine/gate' {
  export class Gate {
    constructor(db: unknown, queue: unknown, options?: { policy?: unknown; ttlMs?: number; ttlByType?: Record<string, number>; notifier?: unknown });
    ttlMs: number;
    pending(): ApprovalRow[];
    findByJob(jobId: number): ApprovalRow | undefined;
    approve(id: number, by?: string | null, note?: string | null): Decision;
    reject(id: number, by?: string | null, note?: string | null): Decision;
    expireOverdue(): number;
  }
  export interface ApprovalRow {
    id: number; job_id: number; reason: string; status: string;
    requested_at: number; expires_at: number;
    decided_at: number | null; decided_by: string | null; note: string | null;
    type?: string; payload?: string;
  }
  export interface Decision { changed: boolean; approval: ApprovalRow | undefined }
}
declare module '@engine/policy' {
  export function makePolicy(rules?: unknown[]): unknown;
  export function alwaysHold(types: string[]): unknown;
  export function amountOver(limit: number, currency?: string): unknown;
  export function recipientOutside(domains: string[]): unknown;
  export const defaultRules: unknown[];
}
declare module '@engine/notify' {
  export function silent(): { notify(event: unknown): void };
  export function fanout(notifiers: { notify(event: unknown): void }[]): { notify(event: unknown): void };
  export function emailNotifier(email: unknown, to: string): { notify(event: unknown): void };
}
declare module '@engine/connectors/email' {
  export function makeEmailConnector(db: unknown): {
    send(spec: { key: string; to: string; subject?: string; body?: string | null; kind?: string }): { sent: boolean; duplicate: boolean };
    count(): number; alertCount(): number; all(): Record<string, unknown>[];
  };
}
declare module '@engine/connectors/crm' {
  export function makeCrmConnector(db: unknown): { upsertContact(spec: Record<string, unknown>): unknown; count(): number };
}
declare module '@engine/connectors/invoicing' {
  export function makeInvoicingConnector(db: unknown): { create(spec: Record<string, unknown>): unknown; count(): number; total(): number };
}
declare module '@engine/ai/model' {
  export function mockModel(options?: { signature?: string }): { name: string; complete(input: { system: string; prompt: string }): Promise<string> };
}
declare module '@engine/ai/draft' {
  export function makeDraftHandler(deps: Record<string, unknown>): (payload: never, job: never) => Promise<unknown>;
  export function makeSendHandler(deps: Record<string, unknown>): (payload: never, job: never) => Promise<unknown>;
}
declare module '@engine/ai/retrieve' {
  export function addDocument(db: unknown, doc: { kind: string; subject: string; body: string }): unknown;
  export function retrieve(db: unknown, query: string, options?: { limit?: number }): Record<string, unknown>[];
}
declare module '@engine/scenarios' {
  export interface Scenario { key: string; title: string; blurb: string; expect: string; run(ctx: Record<string, unknown>): unknown }
  export const scenarios: Scenario[];
  export const byKey: Record<string, Scenario>;
  export function seedKnowledge(db: unknown): void;
}
