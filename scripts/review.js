#!/usr/bin/env node
// The human side of the gate: see what is waiting, and decide.
//
//   node scripts/review.js list
//   node scripts/review.js approve 2 --by ali --note "invoice checked"
//   node scripts/review.js reject  2 --by ali --note "wrong account"
//   node scripts/review.js audit
//
// --db picks the database (default: data/steward.db, or $STEWARD_DB).
const path = require('path');
const fs = require('fs');
const { openDb } = require('../src/db');
const { Queue } = require('../src/queue');
const { Gate } = require('../src/gate');

const argv = process.argv.slice(2);
const command = argv[0];
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};

const dbFile = path.resolve(flag('db', process.env.STEWARD_DB || path.join(__dirname, '..', 'data', 'steward.db')));
if (!fs.existsSync(dbFile)) {
  console.error(`No database at ${dbFile}. Run "npm run demo:gate" first, or pass --db.`);
  process.exit(1);
}

const db = openDb(dbFile);
const gate = new Gate(db, new Queue(db));
const when = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

function list() {
  gate.expireOverdue();
  const open = gate.pending();
  if (open.length === 0) {
    console.log('Nothing is waiting for you.');
    return;
  }
  console.log(`${open.length} waiting:\n`);
  for (const a of open) {
    console.log(`  #${a.id}  ${a.type}`);
    console.log(`      why      ${a.reason}`);
    console.log(`      payload  ${a.payload}`);
    console.log(`      asked    ${when(a.requested_at)}   expires ${when(a.expires_at)}\n`);
  }
  console.log('  node scripts/review.js approve <id> --by <you>');
}

function decide(kind) {
  const id = Number(argv[1]);
  if (!Number.isInteger(id)) {
    console.error(`Which approval? e.g. node scripts/review.js ${kind} 1 --by ali`);
    process.exit(1);
  }
  const result = kind === 'approve'
    ? gate.approve(id, flag('by'), flag('note'))
    : gate.reject(id, flag('by'), flag('note'));

  if (!result.approval) {
    console.error(`No approval #${id}.`);
    process.exit(1);
  }
  if (!result.changed) {
    console.log(`#${id} was already ${result.approval.status} by ${result.approval.decided_by || 'someone'}. Nothing changed.`);
    return;
  }
  console.log(`#${id} ${kind === 'approve' ? 'approved' : 'rejected'}. Job #${result.approval.job_id} is now ${kind === 'approve' ? 'queued to run' : 'stopped'}.`);
}

function audit() {
  for (const row of db.prepare('SELECT * FROM audit_log ORDER BY id').all()) {
    console.log(`${when(row.created_at)}  job ${String(row.job_id ?? '-').padStart(3)}  ${row.event.padEnd(20)} ${row.detail ?? ''}`);
  }
}

const commands = { list, audit, approve: () => decide('approve'), reject: () => decide('reject') };
if (!commands[command]) {
  console.error('Usage: review.js list | approve <id> | reject <id> | audit   [--db file] [--by name] [--note text]');
  process.exit(1);
}
commands[command]();
