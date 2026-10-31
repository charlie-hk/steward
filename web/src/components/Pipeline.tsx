import { Card } from './ui';

// What the gate does, drawn once so the rest of the panel does not have to be
// explained. Inline SVG, because a picture of three outcomes is clearer than
// three paragraphs about them.
export function Pipeline({ counts }: { counts: Record<string, number> }) {
  const n = (key: string) => counts[key] ?? 0;

  return (
    <Card title="How a job moves" subtitle="The gate is asked before the handler runs, so nothing has happened yet when a person is asked.">
      <svg viewBox="0 0 900 230" className="w-full h-auto" role="img" aria-label="A job is claimed, checked against the policy, and either runs or waits for a person">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="#4b5563" />
          </marker>
        </defs>

        <g fontFamily="ui-monospace, monospace" fontSize="13">
          <g>
            <rect x="8" y="86" width="132" height="48" rx="10" fill="#11161d" stroke="#2d3744" />
            <text x="74" y="106" fill="#c9d1d9" textAnchor="middle">claimed</text>
            <text x="74" y="123" fill="#6e7681" textAnchor="middle" fontSize="11">{n('pending') + n('in_progress')} in the queue</text>
          </g>

          <line x1="140" y1="110" x2="196" y2="110" stroke="#4b5563" markerEnd="url(#arrow)" />

          <g>
            <rect x="200" y="78" width="132" height="64" rx="10" fill="#11161d" stroke="#1f6feb" />
            <text x="266" y="104" fill="#58a6ff" textAnchor="middle">the gate</text>
            <text x="266" y="122" fill="#6e7681" textAnchor="middle" fontSize="11">policy, once per job</text>
          </g>

          <path d="M332 96 C 380 96, 390 40, 452 40" fill="none" stroke="#4b5563" markerEnd="url(#arrow)" />
          <path d="M332 124 C 380 124, 390 162, 452 162" fill="none" stroke="#4b5563" markerEnd="url(#arrow)" />
          <text x="372" y="72" fill="#6e7681" fontSize="11">no rule</text>
          <text x="338" y="148" fill="#d29922" fontSize="11">a rule matched</text>

          <g>
            <rect x="456" y="16" width="150" height="48" rx="10" fill="#11161d" stroke="#3fb950" />
            <text x="531" y="36" fill="#3fb950" textAnchor="middle">runs</text>
            <text x="531" y="53" fill="#6e7681" textAnchor="middle" fontSize="11">{n('completed')} completed</text>
          </g>

          <g>
            <rect x="456" y="138" width="150" height="48" rx="10" fill="#1a1710" stroke="#d29922" />
            <text x="531" y="158" fill="#d29922" textAnchor="middle">waits</text>
            <text x="531" y="175" fill="#6e7681" textAnchor="middle" fontSize="11">{n('awaiting_approval')} waiting</text>
          </g>

          <path d="M606 148 C 664 148, 668 48, 712 44" fill="none" stroke="#4b5563" markerEnd="url(#arrow)" />
          <text x="624" y="98" fill="#3fb950" fontSize="11">approve</text>
          <line x1="606" y1="176" x2="712" y2="176" stroke="#4b5563" markerEnd="url(#arrow)" />
          <text x="614" y="169" fill="#f85149" fontSize="11">reject</text>

          <g>
            <rect x="716" y="20" width="160" height="48" rx="10" fill="#11161d" stroke="#2d3744" />
            <text x="796" y="40" fill="#c9d1d9" textAnchor="middle">runs once</text>
            <text x="796" y="57" fill="#6e7681" textAnchor="middle" fontSize="11">never twice</text>
          </g>

          <g>
            <rect x="716" y="152" width="160" height="48" rx="10" fill="#11161d" stroke="#2d3744" />
            <text x="796" y="172" fill="#f85149" textAnchor="middle">stopped</text>
            <text x="796" y="189" fill="#6e7681" textAnchor="middle" fontSize="11">{n('rejected') + n('expired')} rejected or expired</text>
          </g>
        </g>
      </svg>
    </Card>
  );
}
