// Learning from approvals, stage three of the AI layer.
//
// No new storage and no training run. The approval log is already a record of
// what a person was willing to send, so the drafting step is shown the drafts
// that were approved before, on the same topic, and writes its next one in
// their shape. Rejections are kept out: a rejected draft is the one example
// you least want copied.

function approvedExamples(db, { topic = null, limit = 2 } = {}) {
  const sql = `
    SELECT d.body, d.topic, a.note, a.decided_at
    FROM drafts d
    JOIN approvals a ON a.job_id = d.job_id
    WHERE a.status = 'approved' ${topic ? 'AND d.topic = ?' : ''}
    ORDER BY a.decided_at DESC
    LIMIT ?
  `;
  return topic ? db.prepare(sql).all(topic, limit) : db.prepare(sql).all(limit);
}

// What a reviewer turned down, and why. Used as a short "do not do this"
// list rather than as examples to imitate.
function rejectedNotes(db, { topic = null, limit = 3 } = {}) {
  const sql = `
    SELECT d.topic, a.note
    FROM drafts d
    JOIN approvals a ON a.job_id = d.job_id
    WHERE a.status = 'rejected' AND a.note IS NOT NULL ${topic ? 'AND d.topic = ?' : ''}
    ORDER BY a.decided_at DESC
    LIMIT ?
  `;
  return topic ? db.prepare(sql).all(topic, limit) : db.prepare(sql).all(limit);
}

module.exports = { approvedExamples, rejectedNotes };
