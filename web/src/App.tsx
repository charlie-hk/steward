import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { connect } from './api';
import type { DecisionResult, Scenario, Snapshot, StewardApi } from './api/types';
import { Approvals } from './components/Approvals';
import { Audit } from './components/Audit';
import { Jobs } from './components/Jobs';
import { Pipeline } from './components/Pipeline';
import { Policy } from './components/Policy';
import { Scenarios } from './components/Scenarios';
import { Badge, Tile } from './components/ui';

const empty: Snapshot = {
  summary: { jobs: {}, waiting: 0, emails: 0, alerts: 0, invoices: 0 },
  approvals: [], jobs: [], audit: [],
};

export function App() {
  const [api, setApi] = useState<StewardApi | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot>(empty);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reviewer, setReviewer] = useState(() => localStorage.getItem('steward.reviewer') ?? 'ali');
  const polling = useRef(false);

  useEffect(() => {
    let cancelled = false;
    connect()
      .then(async (connected) => {
        if (cancelled) return;
        setApi(connected);
        setScenarios(await connected.scenarios());
      })
      .catch((err: Error) => setError(err.message));
    return () => { cancelled = true; };
  }, []);

  const refresh = useCallback(async (client: StewardApi) => {
    if (polling.current) return;
    polling.current = true;
    try {
      setSnapshot(await client.snapshot());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      polling.current = false;
    }
  }, []);

  // The queue keeps moving on its own: retries come due, approvals expire,
  // released jobs run. A still panel would be lying about that.
  useEffect(() => {
    if (!api) return;
    void refresh(api);
    const timer = setInterval(() => void refresh(api), 1000);
    return () => clearInterval(timer);
  }, [api, refresh]);

  useEffect(() => { localStorage.setItem('steward.reviewer', reviewer); }, [reviewer]);

  const decide = useCallback(
    async (id: number, action: 'approve' | 'reject', note: string): Promise<DecisionResult> => {
      if (!api) return { ok: false, conflict: false, error: 'not connected' };
      const result = await api.decide(id, action, reviewer || 'dashboard', note || null);
      await refresh(api);
      return result;
    },
    [api, refresh, reviewer],
  );

  const counts = snapshot.summary.jobs;
  const stopped = (counts.rejected ?? 0) + (counts.expired ?? 0);
  const queued = (counts.pending ?? 0) + (counts.in_progress ?? 0);

  const tiles = useMemo(() => ([
    { value: snapshot.summary.waiting, label: 'waiting for a person', tone: snapshot.summary.waiting ? 'warn' : 'mute' },
    { value: counts.completed ?? 0, label: 'completed', tone: 'good' },
    { value: queued, label: 'in the queue', tone: 'mute' },
    { value: stopped, label: 'stopped by a person', tone: stopped ? 'bad' : 'mute' },
    { value: counts.failed ?? 0, label: 'failed', tone: counts.failed ? 'bad' : 'mute' },
    { value: snapshot.summary.emails, label: 'emails sent', tone: 'mute' },
    { value: snapshot.summary.invoices, label: 'invoices issued', tone: 'mute' },
  ] as const), [counts, queued, stopped, snapshot.summary]);

  return (
    <div className="min-h-screen">
      <header className="border-b border-edge/70 bg-ink-800/90 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-6xl px-5 py-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="text-xl font-bold tracking-tight text-slate-50">
            Steward<span className="text-good">.</span>
          </h1>
          <p className="text-xs text-slate-500">
            autonomous operations, with a human approval gate
            <a
              className="ml-2 text-slate-600 hover:text-slate-400 font-mono"
              href="https://github.com/charlie-hk"
            >
              A.Amini
            </a>
          </p>
          <div className="ml-auto flex items-center gap-3">
            <label className="label" htmlFor="reviewer">reviewing as</label>
            <input
              id="reviewer"
              className="field w-28 py-1 text-xs font-mono"
              value={reviewer}
              onChange={(event) => setReviewer(event.target.value)}
            />
            <Badge tone={api?.mode === 'live' ? 'good' : 'info'}>
              {api ? (api.mode === 'live' ? 'live service' : 'engine in this tab') : 'starting'}
            </Badge>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-6 space-y-6">
        {api?.mode === 'browser' ? (
          <p className="text-xs text-slate-500 leading-relaxed border border-edge/70 rounded-lg px-4 py-3 bg-ink-700/40">
            There is no server behind this page. The queue, the gate, the policy and the drafting step are
            the same files the service runs, loaded here with SQLite compiled to WebAssembly, so what you
            press is the engine itself rather than a mock of it. Everything is in memory: reloading the
            page starts again from nothing.
          </p>
        ) : null}

        {error ? (
          <p className="text-xs text-bad border border-bad/40 bg-bad/10 rounded-lg px-4 py-3">{error}</p>
        ) : null}

        <div className="flex flex-wrap gap-3">
          {tiles.map((tile) => (
            <Tile key={tile.label} value={tile.value} label={tile.label} tone={tile.tone} />
          ))}
        </div>

        <Scenarios
          scenarios={scenarios}
          onRun={async (key) => { if (api) { await api.runScenario(key); await refresh(api); } }}
          onReset={async () => { if (api) { await api.reset(); await refresh(api); } }}
          canReset={api?.mode === 'browser'}
        />

        <Approvals approvals={snapshot.approvals} reviewer={reviewer} onDecide={decide} />
        <Pipeline counts={counts} />

        <div className="grid gap-6 lg:grid-cols-2">
          <Jobs jobs={snapshot.jobs} />
          <Policy />
        </div>

        <Audit rows={snapshot.audit} />

        <footer className="pt-2 pb-10 text-xs text-slate-600">
          <a className="hover:text-slate-400" href="https://github.com/charlie-hk/steward">
            github.com/charlie-hk/steward
          </a>
        </footer>
      </main>
    </div>
  );
}
