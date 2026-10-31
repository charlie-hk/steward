// What counts as consequential.
//
// Rules are plain functions so a deployment can supply its own set without
// touching the engine. Each one returns a human-readable reason when it
// applies and null when it does not. The first reason wins, so the list runs
// from most specific to least.

const alwaysHold = (types) => (job) =>
  types.includes(job.type) ? `"${job.type}" always needs a person` : null;

const amountOver = (limit, currency = 'USD') => (job, payload) => {
  const amount = Number(payload.amount);
  if (!Number.isFinite(amount)) return null;
  if (amount <= limit) return null;
  return `${currency} ${amount.toFixed(2)} is over the ${currency} ${limit.toFixed(2)} limit`;
};

// An automation allowed to email anyone is one bad draft away from a bad
// afternoon. Mail inside the organisation goes out unattended.
const recipientOutside = (domains) => (job, payload) => {
  if (typeof payload.to !== 'string') return null;
  const domain = payload.to.split('@')[1];
  if (!domain) return `"${payload.to}" is not an address I can check`;
  return domains.includes(domain.toLowerCase()) ? null : `${payload.to} is outside the organisation`;
};

const defaultRules = [
  // Anything a model wrote is in this list on principle: it proposes, a
  // person decides. 'reply.send' is the draft handler's output.
  alwaysHold(['payment.send', 'contract.sign', 'account.close', 'reply.send']),
  amountOver(500),
  recipientOutside(['example.com']),
];

function makePolicy(rules = defaultRules) {
  return {
    review(job, payload = {}) {
      for (const rule of rules) {
        const reason = rule(job, payload);
        if (reason) return { hold: true, reason };
      }
      return { hold: false, reason: null };
    },
  };
}

module.exports = { makePolicy, defaultRules, alwaysHold, amountOver, recipientOutside };
