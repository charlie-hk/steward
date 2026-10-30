const now = () => Date.now();

// A stand-in for a real email provider. The point is not that it sends mail,
// it is that calling it twice with the same idem_key sends once. Real providers
// (Stripe, SendGrid) expose the same guarantee through an idempotency key.
function makeEmailConnector(db) {
  return {
    send({ key, to, subject }) {
      const info = db.prepare(
        'INSERT OR IGNORE INTO sent_emails (idem_key, recipient, subject, created_at) VALUES (?,?,?,?)'
      ).run(key, to, subject, now());
      return { sent: info.changes === 1, duplicate: info.changes === 0 };
    },
    count() {
      return db.prepare('SELECT COUNT(*) n FROM sent_emails').get().n;
    },
  };
}

module.exports = { makeEmailConnector };
