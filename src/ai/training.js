const { SYSTEM } = require('./draft');

// Stage four: turn the approval history into a fine-tuning file.
//
// What this does and does not claim. It does build the exact file a provider's
// fine-tuning endpoint takes, from real approved drafts, and it refuses to
// build a useless one. It does not fine-tune anything: no model here has been
// trained, and on the evidence of stages two and three most of the benefit
// arrives before you would need to. The honest order is retrieval, then
// examples, then this, and only if the first two are not enough.

const MINIMUM = 10;

function buildTrainingSet(db, { minimum = MINIMUM } = {}) {
  const rows = db.prepare(`
    SELECT d.prompt, d.body, a.decided_at
    FROM drafts d
    JOIN approvals a ON a.job_id = d.job_id
    WHERE a.status = 'approved'
    ORDER BY a.decided_at ASC
  `).all();

  const examples = rows.map((row) => ({
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: row.prompt },
      { role: 'assistant', content: row.body },
    ],
  }));

  return {
    examples,
    count: examples.length,
    enough: examples.length >= minimum,
    minimum,
    jsonl: examples.map((e) => JSON.stringify(e)).join('\n'),
  };
}

module.exports = { buildTrainingSet, MINIMUM };
