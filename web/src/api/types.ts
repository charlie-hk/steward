export interface Summary {
  jobs: Record<string, number>;
  waiting: number;
  emails: number;
  alerts: number;
  invoices: number;
}

export interface Job {
  id: number;
  type: string;
  status: string;
  payload: unknown;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  updated_at: number;
  next_run_at: number;
}

export interface Draft {
  body: string;
  model: string;
  topic: string;
  sources: string;
}

export interface Approval {
  id: number;
  job_id: number;
  type: string;
  reason: string;
  payload: unknown;
  requested_at: number;
  expires_at: number;
  draft: Draft | null;
}

export interface AuditRow {
  id: number;
  event: string;
  job_id: number | null;
  detail: string | null;
  created_at: number;
}

export interface Scenario {
  key: string;
  title: string;
  blurb: string;
  expect: string;
}

export interface Snapshot {
  summary: Summary;
  approvals: Approval[];
  jobs: Job[];
  audit: AuditRow[];
}

export type DecisionResult =
  | { ok: true }
  | { ok: false; conflict: true; status: string; by: string | null }
  | { ok: false; conflict: false; error: string };

export interface StewardApi {
  /** 'live' when a real service is answering, 'browser' when the engine is running in this tab. */
  readonly mode: 'live' | 'browser';
  snapshot(): Promise<Snapshot>;
  scenarios(): Promise<Scenario[]>;
  runScenario(key: string): Promise<void>;
  decide(id: number, action: 'approve' | 'reject', by: string, note: string | null): Promise<DecisionResult>;
  reset(): Promise<void>;
}
