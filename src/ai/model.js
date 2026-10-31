// The model adapter.
//
// One method, complete({ system, prompt }) -> string. The default is a mock
// that needs no API key, so the whole system runs and is testable offline and
// the tests never depend on a third party's uptime or wording. Swapping in a
// real model is a constructor argument, not a rewrite: nothing else in the
// codebase knows which one is behind it.

function mockModel({ signature = 'The team' } = {}) {
  return {
    name: 'mock',
    async complete({ prompt }) {
      // Deterministic, and visibly built from what it was given, so the demo
      // shows retrieval and examples doing something rather than claiming it.
      const asked = section(prompt, 'THE MESSAGE');
      const facts = section(prompt, 'WHAT WE KNOW');
      const like = section(prompt, 'REPLIES A PERSON ALREADY APPROVED');
      const name = (asked.match(/from:\s*([^\n<]+)/i) || [, 'there'])[1].trim().split('@')[0];

      const lines = [`Hello ${name},`, ''];
      lines.push('Thank you for getting in touch.');
      if (facts) lines.push('', firstSentence(facts));
      if (like) lines.push('', firstSentence(like));
      lines.push('', 'Please tell me if anything above is wrong and I will correct it.', '', 'Regards,', signature);
      return lines.join('\n');
    },
  };
}

// A real provider, kept to the smallest thing that works. Not exercised by the
// test suite: there is no key in CI, and a test that needs the internet to
// pass is a test that fails for the wrong reasons.
function httpModel({ endpoint, apiKey, model, fetchImpl = globalThis.fetch }) {
  return {
    name: `http:${model}`,
    async complete({ system, prompt }) {
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ] }),
      });
      if (!res.ok) throw new Error(`model returned ${res.status}`);
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      if (typeof text !== 'string') throw new Error('model returned no text');
      return text.trim();
    },
  };
}

function makeModel(env = process.env) {
  if (env.STEWARD_MODEL_URL && env.STEWARD_MODEL_KEY) {
    return httpModel({
      endpoint: env.STEWARD_MODEL_URL,
      apiKey: env.STEWARD_MODEL_KEY,
      model: env.STEWARD_MODEL_NAME || 'gpt-4o-mini',
    });
  }
  return mockModel();
}

function section(text, heading) {
  const match = text.split(new RegExp(`^${heading}\\s*$`, 'm'))[1];
  if (!match) return '';
  return match.split(/^[A-Z][A-Z ]+$/m)[0].trim();
}

function firstSentence(block) {
  const line = block.split('\n').map((l) => l.replace(/^[-\s]+/, '').trim()).find(Boolean) || '';
  return line.length > 220 ? `${line.slice(0, 217)}...` : line;
}

module.exports = { makeModel, mockModel, httpModel };
