const Database = require('better-sqlite3');
const path = require('path');

function openDb(file) {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      type           TEXT    NOT NULL,
      payload        TEXT    NOT NULL DEFAULT '{}',
      status         TEXT    NOT NULL DEFAULT 'pending',
      idempotency_key TEXT   UNIQUE,
      attempts       INTEGER NOT NULL DEFAULT 0,
      max_attempts   INTEGER NOT NULL DEFAULT 3,
      next_run_at    INTEGER NOT NULL,
      lease_until    INTEGER,
      last_error     TEXT,
      created_at     INTEGER NOT NULL,
      updated_at     INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_claimable ON jobs (status, next_run_at);

    -- One approval per job, enforced by the UNIQUE job_id. That constraint is
    -- what makes "ask a human" idempotent: a job that is claimed, held and
    -- claimed again does not open a second request for the same action.
    CREATE TABLE IF NOT EXISTS approvals (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id       INTEGER NOT NULL UNIQUE REFERENCES jobs(id),
      reason       TEXT    NOT NULL,
      status       TEXT    NOT NULL DEFAULT 'pending',
      requested_at INTEGER NOT NULL,
      expires_at   INTEGER NOT NULL,
      decided_at   INTEGER,
      decided_by   TEXT,
      note         TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_approvals_open ON approvals (status, expires_at);

    CREATE TABLE IF NOT EXISTS audit_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      event      TEXT    NOT NULL,
      job_id     INTEGER,
      detail     TEXT,
      created_at INTEGER NOT NULL
    );

    -- Mock connector output. The UNIQUE key is what makes a side effect
    -- safe to retry: a second attempt with the same key changes nothing.
    CREATE TABLE IF NOT EXISTS crm_contacts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      idem_key   TEXT    NOT NULL UNIQUE,
      email      TEXT    NOT NULL,
      name       TEXT,
      company    TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      idem_key     TEXT    NOT NULL UNIQUE,
      customer     TEXT    NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency     TEXT    NOT NULL DEFAULT 'USD',
      created_at   INTEGER NOT NULL
    );

    -- The corpus the drafting step retrieves from: past replies, account
    -- notes, policy documents. Plain rows, searched in JavaScript.
    CREATE TABLE IF NOT EXISTS documents (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      kind       TEXT    NOT NULL,
      subject    TEXT    NOT NULL,
      body       TEXT    NOT NULL,
      created_at INTEGER NOT NULL
    );

    -- What the model wrote, and what it was shown when it wrote it. A draft
    -- belongs to the job that will send it, so the approval, the draft and the
    -- decision are one chain in the log.
    CREATE TABLE IF NOT EXISTS drafts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id     INTEGER UNIQUE REFERENCES jobs(id),
      topic      TEXT    NOT NULL,
      prompt     TEXT    NOT NULL,
      body       TEXT    NOT NULL,
      model      TEXT    NOT NULL,
      sources    TEXT    NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sent_emails (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      idem_key   TEXT    NOT NULL UNIQUE,
      recipient  TEXT    NOT NULL,
      subject    TEXT,
      body       TEXT,
      kind       TEXT    NOT NULL DEFAULT 'mail',
      created_at INTEGER NOT NULL
    );
  `);

  // CREATE TABLE IF NOT EXISTS does nothing to a table that already exists, so
  // a column added later needs its own step. Cheap, and it keeps an old
  // database file working instead of asking someone to delete it.
  const columns = db.prepare('PRAGMA table_info(sent_emails)').all().map((c) => c.name);
  if (!columns.includes('body')) db.exec('ALTER TABLE sent_emails ADD COLUMN body TEXT');
  if (!columns.includes('kind')) db.exec("ALTER TABLE sent_emails ADD COLUMN kind TEXT NOT NULL DEFAULT 'mail'");
}

module.exports = { openDb };
