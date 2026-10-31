const now = () => Date.now();

// Contact records in a CRM. Upsert, not insert: running the same job twice
// leaves one contact with the later values, never two rows for one person.
function makeCrmConnector(db) {
  return {
    upsertContact({ key, email, name = null, company = null }) {
      const before = db.prepare('SELECT id FROM crm_contacts WHERE idem_key = ?').get(key);
      db.prepare(`
        INSERT INTO crm_contacts (idem_key, email, name, company, updated_at)
        VALUES (?,?,?,?,?)
        ON CONFLICT(idem_key) DO UPDATE SET
          email=excluded.email, name=excluded.name,
          company=excluded.company, updated_at=excluded.updated_at
      `).run(key, email, name, company, now());
      return { created: !before, updated: Boolean(before) };
    },
    get(key) {
      return db.prepare('SELECT * FROM crm_contacts WHERE idem_key = ?').get(key);
    },
    count() {
      return db.prepare('SELECT COUNT(*) n FROM crm_contacts').get().n;
    },
  };
}

module.exports = { makeCrmConnector };
