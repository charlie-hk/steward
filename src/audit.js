const now = () => Date.now();

function audit(db, event, jobId, detail) {
  db.prepare('INSERT INTO audit_log (event, job_id, detail, created_at) VALUES (?,?,?,?)')
    .run(event, jobId ?? null, detail ? JSON.stringify(detail) : null, now());
}

module.exports = { audit };
