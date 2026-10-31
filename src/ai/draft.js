const { retrieve } = require('./retrieve');
const { approvedExamples, rejectedNotes } = require('./examples');

const SYSTEM = [
  'You write short replies on behalf of a small company.',
  'Use only the facts you are given. Never invent a date, a figure or a promise.',
  'If the facts do not answer the question, say what you will find out and by when.',
].join(' ');

function buildPrompt({ from, topic, question, sources, examples, avoid }) {
  const out = ['THE MESSAGE', `from: ${from}`, `topic: ${topic}`, '', question, ''];

  out.push('WHAT WE KNOW');
  out.push(sources.length
    ? sources.map((s) => `- ${s.subject}: ${s.body}`).join('\n')
    : '- nothing on file about this');
  out.push('');

  if (examples.length) {
    out.push('REPLIES A PERSON ALREADY APPROVED');
    out.push(examples.map((e) => `- ${e.body.replace(/\n+/g, ' ').trim()}`).join('\n'));
    out.push('');
  }
  if (avoid.length) {
    out.push('WHAT A REVIEWER TURNED DOWN BEFORE');
    out.push(avoid.map((r) => `- ${r.note}`).join('\n'));
    out.push('');
  }
  out.push('WRITE THE REPLY');
  return out.join('\n');
}

// Drafting, stage one of the AI layer, with stages two and three folded in:
// retrieve first, show what was approved before, then ask the model.
//
// The handler does not send anything. It writes a draft and enqueues the job
// that would send it, and that job is what the gate holds. So the order is
// always: the model proposes, a person decides, then the action happens.
function makeDraftHandler({ db, queue, model, topicKey = 'topic' }) {
  return async (payload, job) => {
    const topic = payload[topicKey] || 'general';
    const question = payload.question || '';

    const sources = retrieve(db, `${topic} ${question}`);
    const examples = approvedExamples(db, { topic });
    const avoid = rejectedNotes(db, { topic });
    const prompt = buildPrompt({ from: payload.from, topic, question, sources, examples, avoid });

    const body = await model.complete({ system: SYSTEM, prompt });

    // Keyed on the drafting job, so a rerun after a crash reuses the same send
    // job instead of queueing a second reply to the same customer.
    const send = queue.enqueue({
      type: 'reply.send',
      payload: { to: payload.from, subject: `Re: ${topic}`, topic },
      idempotencyKey: `reply:${job.id}`,
    });

    db.prepare(`
      INSERT INTO drafts (job_id, topic, prompt, body, model, sources, created_at)
      VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(job_id) DO UPDATE SET body=excluded.body, prompt=excluded.prompt
    `).run(send.id, topic, prompt, body, model.name, JSON.stringify(sources.map((s) => s.subject)), Date.now());

    return { draftFor: send.id };
  };
}

// Sends what was approved. It reads the draft from the database rather than
// from the payload, so what goes out is the text the reviewer saw.
function makeSendHandler({ db, email }) {
  return async (payload, job) => {
    const draft = db.prepare('SELECT * FROM drafts WHERE job_id = ?').get(job.id);
    if (!draft) throw new Error(`no draft for job ${job.id}`);
    email.send({ key: `reply:${job.id}`, to: payload.to, subject: payload.subject, body: draft.body });
  };
}

module.exports = { makeDraftHandler, makeSendHandler, buildPrompt, SYSTEM };
