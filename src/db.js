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

    CREATE TABLE IF NOT EXISTS audit_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      event      TEXT    NOT NULL,
      job_id     INTEGER,
      detail     TEXT,
      created_at INTEGER NOT NULL
    );

    -- Mock connector output. The UNIQUE key is what makes a side effect
    -- safe to retry: a second attempt with the same key changes nothing.
    CREATE TABLE IF NOT EXISTS sent_emails (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      idem_key   TEXT    NOT NULL UNIQUE,
      recipient  TEXT    NOT NULL,
      subject    TEXT,
      created_at INTEGER NOT NULL
    );
  `);
}

module.exports = { openDb };
