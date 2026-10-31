const { test } = require('node:test');
const assert = require('node:assert');
const { createSteward } = require('../src/steward');
const { createServer } = require('../src/server');

// Against a real listening server over real HTTP. Mounting the app and
// calling its handlers directly would skip the parts most likely to be wrong.
async function withServer(run) {
  const steward = createSteward({ quiet: true });
  const server = createServer(steward).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run({ ...steward, base, get: (p) => fetch(base + p).then((r) => r.json()) });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

const post = (base, path, body) => fetch(base + path, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

test('the dashboard lists what is waiting, with the draft attached', async () => {
  await withServer(async ({ queue, worker, get }) => {
    queue.enqueue({ type: 'payment.send', payload: { to: 'Acme Ltd', amount: 4820 } });
    await worker.drain();

    const waiting = await get('/api/approvals');
    assert.equal(waiting.length, 1);
    assert.equal(waiting[0].type, 'payment.send');
    assert.equal(waiting[0].payload.amount, 4820);
    assert.match(waiting[0].reason, /needs a person/);

    const summary = await get('/api/summary');
    assert.equal(summary.waiting, 1);
    assert.equal(summary.jobs.awaiting_approval, 1);
  });
});

test('approving over HTTP releases the job; a second press is refused with 409', async () => {
  await withServer(async ({ base, queue, worker, get }) => {
    queue.enqueue({ type: 'payment.send', payload: { to: 'Acme Ltd', amount: 4820 } });
    await worker.drain();
    const [waiting] = await get('/api/approvals');

    const first = await post(base, `/api/approvals/${waiting.id}/approve`, { by: 'ali', note: 'checked' });
    assert.equal(first.status, 200);

    const second = await post(base, `/api/approvals/${waiting.id}/approve`, { by: 'sam' });
    assert.equal(second.status, 409);
    const body = await second.json();
    assert.equal(body.status, 'approved');
    assert.equal(body.by, 'ali');

    await worker.drain();
    const jobs = await get('/api/jobs');
    assert.equal(jobs[0].status, 'completed');
    assert.equal((await get('/api/approvals')).length, 0);
  });
});

test('rejecting over HTTP stops the job and records who did it', async () => {
  await withServer(async ({ base, queue, worker, get }) => {
    queue.enqueue({ type: 'payment.send', payload: { to: 'Acme Ltd', amount: 4820 } });
    await worker.drain();
    const [waiting] = await get('/api/approvals');

    const res = await post(base, `/api/approvals/${waiting.id}/reject`, { by: 'ali', note: 'wrong account' });
    assert.equal(res.status, 200);

    await worker.drain();
    const jobs = await get('/api/jobs');
    assert.equal(jobs[0].status, 'rejected');

    const audit = await get('/api/audit');
    const decision = audit.find((row) => row.event === 'approval.rejected');
    assert.match(decision.detail, /wrong account/);
    assert.match(decision.detail, /ali/);
  });
});

test('an approval that does not exist is a 404, not a crash', async () => {
  await withServer(async ({ base }) => {
    const res = await post(base, '/api/approvals/999/approve', { by: 'ali' });
    assert.equal(res.status, 404);
  });
});

test('the dashboard page itself is served', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(base + '/');
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Steward/);
  });
});
