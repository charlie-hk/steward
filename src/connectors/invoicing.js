const now = () => Date.now();

// Invoices are the clearest case for the whole project: issuing one twice is
// not a glitch, it is a customer phoning about a double charge. Amounts are
// held in cents so no rounding happens on the way in.
function makeInvoicingConnector(db) {
  return {
    create({ key, customer, amount, currency = 'USD' }) {
      const cents = Math.round(Number(amount) * 100);
      if (!Number.isFinite(cents)) throw new Error(`invalid amount: ${amount}`);
      const info = db.prepare(`
        INSERT OR IGNORE INTO invoices (idem_key, customer, amount_cents, currency, created_at)
        VALUES (?,?,?,?,?)
      `).run(key, customer, cents, currency, now());
      const row = db.prepare('SELECT * FROM invoices WHERE idem_key = ?').get(key);
      return { invoice: row, created: info.changes === 1, duplicate: info.changes === 0 };
    },
    total() {
      return (db.prepare('SELECT COALESCE(SUM(amount_cents),0) c FROM invoices').get().c) / 100;
    },
    count() {
      return db.prepare('SELECT COUNT(*) n FROM invoices').get().n;
    },
  };
}

module.exports = { makeInvoicingConnector };
