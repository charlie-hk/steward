// Retrieval, stage two of the AI layer.
//
// Keyword scoring over the documents table, not embeddings. That is a
// deliberate limit and worth stating plainly: it finds documents that share
// rare words with the question and will miss a document that means the same
// thing in different words. It needs no vector database, no embedding API and
// no network, and for a few thousand internal documents it is enough. The
// interface is the part that matters: swap this function for an embedding
// search and nothing above it changes.

const STOP = new Set(`a an and are as at be but by for from has have i if in is it its
of on or that the their them they this to was were what when where which who will with you your`
  .split(/\s+/));

function tokenize(text) {
  return String(text).toLowerCase().match(/[a-z0-9']+/g)?.filter((w) => w.length > 2 && !STOP.has(w)) ?? [];
}

function retrieve(db, query, { limit = 3, kinds = null } = {}) {
  const terms = new Set(tokenize(query));
  if (terms.size === 0) return [];

  const rows = kinds
    ? db.prepare(`SELECT * FROM documents WHERE kind IN (${kinds.map(() => '?').join(',')})`).all(...kinds)
    : db.prepare('SELECT * FROM documents').all();
  if (rows.length === 0) return [];

  // A word in every document tells you nothing; a word in one document tells
  // you a lot. That is all the weighting there is.
  const docTokens = rows.map((row) => new Set(tokenize(`${row.subject} ${row.body}`)));
  const seenIn = new Map();
  for (const tokens of docTokens) {
    for (const token of tokens) seenIn.set(token, (seenIn.get(token) || 0) + 1);
  }

  return rows
    .map((row, i) => {
      let score = 0;
      for (const term of terms) {
        if (!docTokens[i].has(term)) continue;
        score += Math.log(rows.length / seenIn.get(term)) + 0.5;
      }
      return { ...row, score: Number(score.toFixed(3)) };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || b.created_at - a.created_at)
    .slice(0, limit);
}

function addDocument(db, { kind, subject, body }) {
  const info = db.prepare(
    'INSERT INTO documents (kind, subject, body, created_at) VALUES (?,?,?,?)'
  ).run(kind, subject, body, Date.now());
  return db.prepare('SELECT * FROM documents WHERE id = ?').get(info.lastInsertRowid);
}

module.exports = { retrieve, addDocument, tokenize };
