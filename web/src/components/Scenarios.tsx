import { useState } from 'react';
import { Card } from './ui';
import type { Scenario } from '../api/types';

export function Scenarios({ scenarios, onRun, onReset, canReset }: {
  scenarios: Scenario[];
  onRun: (key: string) => Promise<void>;
  onReset: () => Promise<void>;
  canReset: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string) => {
    setBusy(key);
    try { await onRun(key); } finally { setBusy(null); }
  };

  return (
    <Card
      title="Try something"
      subtitle="Each button puts real work into the queue. Nothing here is a recording."
      action={canReset ? <button className="btn-ghost" onClick={() => void onReset()}>Start over</button> : null}
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {scenarios.map((scenario) => (
          <button
            key={scenario.key}
            onClick={() => void run(scenario.key)}
            disabled={busy !== null}
            className="text-left bg-ink-900/60 border border-edge rounded-xl p-4 hover:border-info/60
                       disabled:opacity-60 transition-colors group"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-100">{scenario.title}</span>
              <span className="ml-auto text-[11px] font-mono text-slate-600 group-hover:text-[#58a6ff]">
                {busy === scenario.key ? 'running' : 'run'}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">{scenario.blurb}</p>
            <p className="text-xs text-warn/90 mt-2 leading-relaxed">{scenario.expect}</p>
          </button>
        ))}
      </div>
    </Card>
  );
}
