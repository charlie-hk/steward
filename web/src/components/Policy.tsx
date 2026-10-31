import { Card } from './ui';

const rules = [
  {
    rule: "alwaysHold(['payment.send', 'contract.sign', 'account.close', 'reply.send'])",
    why: 'Moves money, binds the company, closes an account, or was written by a model.',
  },
  { rule: 'amountOver(500)', why: 'Any payload with an amount above the limit, whatever the job type is.' },
  { rule: "recipientOutside(['example.com'])", why: 'Mail inside the organisation goes out unattended. Mail to a customer does not.' },
];

export function Policy() {
  return (
    <Card
      title="The policy"
      subtitle="Plain functions, checked in order, first reason wins. A deployment supplies its own without touching the engine."
    >
      <ul className="space-y-3">
        {rules.map((entry) => (
          <li key={entry.rule} className="bg-ink-900/50 border border-edge/60 rounded-lg px-4 py-3">
            <code className="text-[12.5px] font-mono text-[#58a6ff] break-all">{entry.rule}</code>
            <p className="text-xs text-slate-400 mt-1.5">{entry.why}</p>
          </li>
        ))}
      </ul>
      <p className="text-xs text-slate-500 mt-4 leading-relaxed">
        The policy is consulted once, the first time a job reaches the gate, and the answer is written
        down. Changing the rules afterwards does not re-open a job somebody already approved.
      </p>
    </Card>
  );
}
