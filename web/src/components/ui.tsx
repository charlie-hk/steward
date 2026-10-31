import type { ReactNode } from 'react';

const tones = {
  good: 'text-good border-good/40 bg-good/10',
  warn: 'text-warn border-warn/40 bg-warn/10',
  bad: 'text-bad border-bad/40 bg-bad/10',
  info: 'text-[#58a6ff] border-info/40 bg-info/10',
  mute: 'text-slate-400 border-edge bg-white/5',
} as const;

export type Tone = keyof typeof tones;

export function Badge({ tone = 'mute', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-mono ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Tile({ value, label, tone = 'mute' }: { value: ReactNode; label: string; tone?: Tone }) {
  const colour = tone === 'mute' ? 'text-slate-100' : tones[tone].split(' ')[0];
  return (
    <div className="card px-4 py-3 min-w-[128px]">
      <div className={`text-2xl font-semibold tabular-nums ${colour}`}>{value}</div>
      <div className="label mt-0.5">{label}</div>
    </div>
  );
}

export function Card({ title, subtitle, action, children }: {
  title?: string; subtitle?: string; action?: ReactNode; children: ReactNode;
}) {
  return (
    <section className="card overflow-hidden">
      {title ? (
        <header className="flex items-start gap-4 px-5 py-4 border-b border-edge/70">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
            {subtitle ? <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p> : null}
          </div>
          {action ? <div className="ml-auto shrink-0">{action}</div> : null}
        </header>
      ) : null}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-slate-500 py-2">{children}</p>;
}

export function statusTone(status: string): Tone {
  if (status === 'completed') return 'good';
  if (status === 'awaiting_approval') return 'warn';
  if (status === 'failed' || status === 'rejected' || status === 'expired') return 'bad';
  return 'mute';
}

export function ago(ms: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

export function inFuture(ms: number): string {
  const seconds = Math.round((ms - Date.now()) / 1000);
  if (seconds <= 0) return 'expired';
  if (seconds < 60) return `${seconds}s left`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m left`;
  return `${Math.round(seconds / 3600)}h left`;
}
