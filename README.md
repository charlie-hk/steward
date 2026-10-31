# Steward

![Steward](cover.png)

An autonomous operations engine with a human approval gate. It runs unattended,
survives restarts, and is built so that a consequential action, such as sending
an email or creating an invoice, is never performed twice.

This is the reliability core that a business automation ("AI COO") system needs
before any of its integrations can be trusted. The integrations are the easy,
replaceable part. The hard part is making an always-on worker that does the
right thing after a crash, and that is what this project is about.

## The problem it solves

An automation that acts on your behalf has two failure modes that matter:

1. It does something twice. The process dies after sending an email but before
   recording that it sent it, restarts, and sends it again.
2. It does something it should not have. It emails a customer or moves money
   without anyone approving it.

Steward is designed around both. Every unit of work goes through a durable
queue with an idempotency guarantee, and any action marked consequential waits
for explicit human approval before it runs.

## Status

Built and tested:

- Durable job queue on SQLite that survives process restarts.
- Idempotent enqueue: the same idempotency key never creates a second job.
- Retry with exponential backoff, and a terminal `failed` state after
  `max_attempts`.
- Lease-based crash recovery: a job whose worker died is returned to the queue
  once its lease expires, and reruns without repeating its side effect.
- A human approval gate for consequential actions, described below.
- An append-only audit log of every state change and every human decision.
- A mock connector (email) that is idempotent at the data layer, mirroring how
  real providers (Stripe, SendGrid) use an idempotency key.
- A review CLI: see what is waiting, approve it, reject it, read the log.

Planned, built in stages:

- An approval dashboard over HTTP, on top of the gate that now exists.
- More mock connectors (CRM, invoicing).
- The AI layer described below.

## The approval gate

A rule decides whether an action is consequential. The worker asks the gate
about every job it claims, **before** the handler runs, so nothing has happened
yet when a person is asked about it. The gate answers with one of three things:
run it, hold it, or stop.

```
                   +-- no rule matched ------------------> run the handler
claim a job -----> |
                   +-- a rule matched --> awaiting_approval
                                                |
                                   approve ---> back in the queue, runs once
                                   reject  ---> rejected, the handler never runs
                                   nobody  ---> expired, the handler never runs
```

The rules are plain functions, so a deployment supplies its own without
touching the engine (`src/policy.js`). The defaults hold anything that moves
money or signs something, any payload over a limit, and any email leaving the
organisation:

```js
const { makePolicy, alwaysHold, amountOver } = require('./src/policy');

const policy = makePolicy([
  alwaysHold(['payment.send', 'contract.sign']),
  amountOver(500),
]);
```

Four details matter more than the feature itself, and each has a test:

- **One request per job.** `approvals.job_id` is UNIQUE. A job that is claimed,
  held, and claimed again does not open a second request, so a restart loop
  cannot turn into a flood of notifications.
- **One decision, ever.** The decision is an UPDATE conditional on the row
  still being pending, inside the same transaction that releases the job. Two
  reviewers pressing Approve at the same moment produce one decision and one
  run; pressing it twice changes nothing.
- **The decision outranks the rule.** The policy is consulted once, the first
  time a job reaches the gate, and the answer is written down. Changing the
  rules afterwards does not re-open a job a person has already approved.
- **Silence is not consent.** An approval nobody answers expires, and the job
  stops. Waiting also consumes no retry attempt: a job held for review has not
  failed, and must not burn its budget while it waits.

Watch it happen:

```bash
npm run demo:gate
```

Four jobs go in. Two run unattended, two wait. A refund email to an outside
address is approved and sends exactly once; a USD 4,820 payment is rejected and
never runs. The audit log at the end says who decided what, and when.

Then take the human side yourself:

```bash
node scripts/review.js list   --db data/gate-demo.db
node scripts/review.js approve 1 --by ali --note "invoice checked" --db data/gate-demo.db
node scripts/review.js audit  --db data/gate-demo.db
```

## The AI layer

An automation like this is more useful when a step can draft something, for
example a reply to a customer email, and leave the decision to a human. The
model never acts on its own; it proposes, the approval gate holds the proposal,
and a person approves or rejects it.

The intelligence is added in four stages, from the simplest and most honest to
the most involved. Each one is a real, well-understood technique, not a claim
to have built a model from scratch. Training a base language model is the work
of a large research team and is out of scope here; Steward uses a model, it
does not try to be one.

1. **Use a model.** A drafting step calls a model API (OpenAI, Anthropic, or a
   local model) behind a thin adapter. The default adapter is a mock that
   returns a fixed draft, so the system runs and is testable with no API key.
   The model is used, not changed.

2. **Give it memory (retrieval).** Before drafting, the step retrieves relevant
   past context, approved replies, account history, documents, and passes it to
   the model. The model stays fixed; the system behaves as if it has learned
   because its answers are grounded in your own data.

3. **Learn from approvals (feedback loop).** Every approval and rejection is
   already recorded by the approval gate. That log becomes training signal:
   the drafting step is shown previously approved examples so new drafts move
   toward what a human has accepted before. This is learning at the level of
   examples and memory, built on data the system already keeps.

4. **Fine-tune (optional).** When there is enough approved history, a base
   model can be lightly fine-tuned on it to match a house tone or format.
   This actually adjusts the model, but only its style, and in practice stages
   2 and 3 cover most needs more cheaply.

The through-line: Steward never pretends to think on its own. It acts
autonomously, keeps a record of every human decision, and uses that record to
get better. Stages 1 and 2 are the near-term targets; 3 and 4 build on the
approval history the gate produces.

## The guarantee, and the test that proves it

The important claim is "a crash mid-job does not cause a duplicate side
effect". The test in `test/queue.test.js` sets it up directly: a handler sends
an email and then throws before the job is marked complete, exactly like a
process dying mid-flight. The lease expires, a fresh worker recovers the job
and reruns it, and the test asserts the email was sent exactly once.

It works because of two things together:

- A leased job whose worker vanished is reclaimed, so nothing is silently lost.
- The side effect itself is keyed, so running it a second time is a no-op.

## Run it

```bash
npm install
npm test          # 12 passing
npm run demo      # the durable queue, end to end
npm run demo:gate # the approval gate, end to end
```

## Layout

```
src/
  db.js               schema: jobs, approvals, audit_log, connector output
  queue.js            enqueue, claim, complete, fail, retry, hold, release, recovery
  worker.js           the processing loop, crash recovery, the gate check
  gate.js             approval requests, decisions, expiry
  policy.js           the rules that decide what needs a person
  audit.js            append-only audit log
  connectors/
    email.js          idempotent mock connector
test/
  queue.test.js       idempotent enqueue, retry, and the crash test
  approvals.test.js   held, approved, rejected, expired, and decided twice
scripts/
  demo.js             the queue, end to end
  demo-gate.js        the approval gate, end to end
  review.js           the reviewer's CLI
```

## Related work

The same reliability discipline, applied to a different domain, is in
[LiveReel](https://github.com/charlie-hk/livereel-media-pipeline), a control
plane for live media pipelines with supervised processes and restart recovery.

## License

MIT.
