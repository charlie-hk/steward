import { Card, Empty, ago } from './ui';
import type { AuditRow } from '../api/types';

const colour = (event: string) => {
  if (event.startsWith('approval.approved')) return 'text-good';
  if (event.startsWith('approval.rejected') || event.startsWith('approval.expired')) return 'text-bad';
  if (event.startsWith('approval.')) return 'text-warn';
  if (event === 'job.failed') return 'text-bad';
  return 'text-slate-400';
};

export function Audit({ rows }: { rows: AuditRow[] }) {
  return (
    <Card title="Audit log" subtitle="Append-only. Every state change and every human decision, with the note they left.">
      {rows.length === 0 ? (
        <Empty>Nothing has happened yet.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px] font-mono">
            <tbody>
              {rows.slice(0, 18).map((row) => (
                <tr key={row.id} className="border-b border-edge/50 last:border-0">
                  <td className="py-1.5 pr-3 text-slate-600 w-10">{row.job_id ? `#${row.job_id}` : ''}</td>
                  <td className={`py-1.5 pr-3 whitespace-nowrap ${colour(row.event)}`}>{row.event}</td>
                  <td className="py-1.5 pr-3 text-slate-500 break-all">{row.detail ?? ''}</td>
                  <td className="py-1.5 text-right text-slate-600 whitespace-nowrap">{ago(row.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
