const now = () => Date.now();

// A stand-in for a real email provider. The point is not that it sends mail,
// it is that calling it twice with the same idem_key sends once. Real providers
// (Stripe, SendGrid) expose the same guarantee through an idempotency key.
function makeEmailConnector(db) {
  return {
    send({ key, to, subject, body = null, kind = 'mail' }) {
      const info = db.prepare(
        'INSERT OR IGNORE INTO sent_emails (idem_key, recipient, subject, body, kind, created_at) VALUES (?,?,?,?,?,?)'
      ).run(key, to, subject, body, kind, now());
      return { sent: info.changes === 1, duplicate: info.changes === 0 };
    },
    // Mail to people the business deals with. Internal alerts are counted
    // apart, so "how many emails went out" is not inflated by the system
    // talking to its own operators.
    count() {
      return db.prepare("SELECT COUNT(*) n FROM sent_emails WHERE kind = 'mail'").get().n;
    },
    alertCount() {
      return db.prepare("SELECT COUNT(*) n FROM sent_emails WHERE kind = 'alert'").get().n;
    },
    all() {
      return db.prepare('SELECT * FROM sent_emails ORDER BY id').all();
    },
  };
}

module.exports = { makeEmailConnector };
