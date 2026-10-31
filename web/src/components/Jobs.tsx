import { Badge, Card, Empty, ago, statusTone } from './ui';
import type { Job } from '../api/types';

export function Jobs({ jobs }: { jobs: Job[] }) {
  return (
    <Card title="Jobs" subtitle="Newest first. Attempts and the last error are kept on the row.">
      {jobs.length === 0 ? (
        <Empty>The queue is empty.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] font-mono">
            <tbody>
              {jobs.slice(0, 14).map((job) => (
                <tr key={job.id} className="border-b border-edge/50 last:border-0">
                  <td className="py-2 pr-3 text-slate-600 w-10">#{job.id}</td>
                  <td className="py-2 pr-3 text-slate-200">{job.type}</td>
                  <td className="py-2 pr-3"><Badge tone={statusTone(job.status)}>{job.status}</Badge></td>
                  <td className="py-2 pr-3 text-slate-600 whitespace-nowrap">
                    {job.attempts > 0 ? `attempt ${job.attempts}/${job.max_attempts}` : ''}
                  </td>
                  <td className="py-2 pr-3 text-slate-500 max-w-[260px] truncate hidden sm:table-cell" title={job.last_error ?? ''}>
                    {job.last_error ?? ''}
                  </td>
                  <td className="py-2 text-right text-slate-600 whitespace-nowrap">{ago(job.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
