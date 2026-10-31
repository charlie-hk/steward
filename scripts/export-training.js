#!/usr/bin/env node
// Export approved drafts as a fine-tuning file.
//   node scripts/export-training.js --db data/ai-demo.db --out data/training.jsonl
const path = require('path');
const fs = require('fs');
const { openDb } = require('../src/db');
const { buildTrainingSet } = require('../src/ai/training');

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};

const dbFile = path.resolve(flag('db', process.env.STEWARD_DB || path.join(__dirname, '..', 'data', 'steward.db')));
if (!fs.existsSync(dbFile)) {
  console.error(`No database at ${dbFile}.`);
  process.exit(1);
}

const out = path.resolve(flag('out', path.join(path.dirname(dbFile), 'training.jsonl')));
const set = buildTrainingSet(openDb(dbFile), { minimum: Number(flag('minimum', 10)) });

if (!set.enough) {
  console.error(`${set.count} approved draft(s). Fewer than ${set.minimum} is not a training set, it is noise. Nothing written.`);
  process.exit(1);
}

fs.writeFileSync(out, `${set.jsonl}\n`);
console.log(`${set.count} approved drafts -> ${path.relative(process.cwd(), out)}`);
console.log('\nThat file is the input to a provider fine-tune. Nothing here runs one:');
console.log('  openai api fine_tuning.jobs.create -t training.jsonl -m gpt-4o-mini');
