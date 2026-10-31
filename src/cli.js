#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const { createSteward } = require('./steward');
const { createServer } = require('./server');

const argv = process.argv.slice(2);
const command = argv[0] || 'serve';
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};

const dbFile = path.resolve(flag('db', process.env.STEWARD_DB || path.join(__dirname, '..', 'data', 'steward.db')));
fs.mkdirSync(path.dirname(dbFile), { recursive: true });

const steward = createSteward({ dbFile, pollMs: Number(flag('poll', 500)) });
const { db, queue, gate, runner } = steward;

let server = null;
if (command === 'serve') {
  const port = Number(flag('port', process.env.PORT || 3000));
  server = createServer({ db, queue, gate }).listen(port, () => {
    console.log(`dashboard  http://localhost:${port}`);
  });
} else if (command !== 'work') {
  console.error('Usage: cli.js [serve|work] [--port 3000] [--db data/steward.db] [--poll 500]');
  process.exit(1);
}

runner.start();
console.log(`worker     polling every ${runner.pollMs}ms`);
console.log(`database   ${dbFile}`);

// Shutting down is the whole argument of this project, so it is done properly:
// stop taking new work, let the job in flight finish, then close. A second
// signal means the operator is out of patience and gets an immediate exit.
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    if (stopping) { console.log('\nforced'); process.exit(1); }
    stopping = true;
    console.log('\nfinishing the job in flight, then stopping');
    if (server) await new Promise((r) => server.close(r));
    await runner.stop();
    db.close();
    console.log('stopped cleanly');
    process.exit(0);
  });
}
