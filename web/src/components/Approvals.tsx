import { useState } from 'react';
import { Badge, Card, Empty, inFuture, ago } from './ui';
import type { Approval, DecisionResult } from '../api/types';

export function Approvals({ approvals, reviewer, onDecide }: {
  approvals: Approval[];
  reviewer: string;
  onDecide: (id: number, action: 'approve' | 'reject', note: string) => Promise<DecisionResult>;
}) {
  return (
    <Card
      title="Waiting for a person"
      subtitle="Held before the handler ran. Approving releases the job; rejecting stops it for good."
    >
      {approvals.length === 0 ? (
        <Empty>Nothing is waiting. Run a scenario above.</Empty>
      ) : (
        <ul className="space-y-3">
          {approvals.map((approval) => (
            <Row key={approval.id} approval={approval} reviewer={reviewer} onDecide={onDecide} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function Row({ approval, reviewer, onDecide }: {
  approval: Approval;
  reviewer: string;
  onDecide: (id: number, action: 'approve' | 'reject', note: string) => Promise<DecisionResult>;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);

  const decide = async (action: 'approve' | 'reject') => {
    setBusy(true);
    setConflict(null);
    try {
      const result = await onDecide(approval.id, action, note);
      // Someone else got there first. Saying so beats quietly redrawing the row.
      if (!result.ok && result.conflict) {
        setConflict(`Already ${result.status} by ${result.by ?? 'someone'}. Nothing changed.`);
      }
    } finally {
      setBusy(false);
    }
  };

  const sources: string[] = approval.draft ? safeList(approval.draft.sources) : [];

  return (
    <li className="bg-ink-900/50 border border-edge/70 border-l-2 border-l-warn rounded-xl p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono text-sm font-semibold text-slate-100">{approval.type}</span>
        <span className="text-xs text-warn">{approval.reason}</span>
        <span className="ml-auto font-mono text-[11px] text-slate-600">
          #{approval.id} · asked {ago(approval.requested_at)} · {inFuture(approval.expires_at)}
        </span>
      </div>

      <pre className="mt-3 bg-ink-900 border border-edge/70 rounded-lg px-3 py-2 text-[12px] font-mono text-slate-400 overflow-x-auto">
        {JSON.stringify(approval.payload)}
      </pre>

      {approval.draft ? (
        <>
          <pre className="mt-2 bg-ink-900 border border-edge/70 rounded-lg px-3 py-2.5 text-[12.5px] font-mono text-slate-300 whitespace-pre-wrap">
            {approval.draft.body}
          </pre>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge tone="info">written by {approval.draft.model}</Badge>
            <Badge>sources: {sources.join(', ') || 'none on file'}</Badge>
          </div>
        </>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          className="field flex-1 min-w-[200px] text-xs"
          placeholder="why (recorded in the audit log)"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          aria-label={`Note for approval ${approval.id}`}
        />
        <button className="btn-reject" disabled={busy} onClick={() => void decide('reject')}>Reject</button>
        <button className="btn-approve" disabled={busy} onClick={() => void decide('approve')}>Approve</button>
      </div>

      <p className="text-[11px] text-slate-600 mt-2">
        decided as <span className="font-mono text-slate-500">{reviewer}</span>
      </p>
      {conflict ? <p className="text-xs text-bad mt-1">{conflict}</p> : null}
    </li>
  );
}

function safeList(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
