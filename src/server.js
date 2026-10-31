const path = require('path');
const express = require('express');
const { scenarios, byKey } = require('./scenarios');

// The dashboard's API.
//
// Thin on purpose: every rule about approvals lives in the gate, and the HTTP
// layer only translates. The one thing it adds is status codes, and the one
// worth arguing about is 409: pressing Approve on something already decided is
// not an error in the server, it is the server telling you that somebody got
// there first. The UI shows that rather than silently reloading.
// The built panel in ../docs is what the service serves and what GitHub Pages
// serves. One frontend, not two that drift.
const BUILT_PANEL = path.join(__dirname, '..', 'docs');

function createServer({ db, queue, gate, worker, connectors, staticDir = BUILT_PANEL }) {
  const app = express();
  app.use(express.json());

  const reviewer = (req) => (typeof req.body?.by === 'string' && req.body.by.trim()) || 'dashboard';

  app.get('/api/summary', (req, res) => {
    gate.expireOverdue();
    res.json({
      jobs: queue.counts(),
      waiting: gate.pending().length,
      emails: db.prepare("SELECT COUNT(*) n FROM sent_emails WHERE kind = 'mail'").get().n,
      alerts: db.prepare("SELECT COUNT(*) n FROM sent_emails WHERE kind = 'alert'").get().n,
      invoices: db.prepare('SELECT COUNT(*) n FROM invoices').get().n,
    });
  });

  app.get('/api/approvals', (req, res) => {
    gate.expireOverdue();
    const rows = gate.pending().map((row) => ({
      ...row,
      payload: safeJson(row.payload),
      draft: db.prepare('SELECT body, model, topic, sources FROM drafts WHERE job_id = ?').get(row.job_id) || null,
    }));
    res.json(rows);
  });

  app.get('/api/jobs', (req, res) => {
    const rows = db.prepare('SELECT * FROM jobs ORDER BY id DESC LIMIT 100').all();
    res.json(rows.map((row) => ({ ...row, payload: safeJson(row.payload) })));
  });

  app.get('/api/audit', (req, res) => {
    res.json(db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 200').all());
  });

  for (const [verb, action] of [['approve', 'approve'], ['reject', 'reject']]) {
    app.post(`/api/approvals/:id/${verb}`, (req, res) => {
      const id = Number(req.params.id);
      const result = gate[action](id, reviewer(req), req.body?.note ?? null);
      if (!result.approval) return res.status(404).json({ error: `no approval #${id}` });
      if (!result.changed) {
        return res.status(409).json({
          error: 'already decided',
          status: result.approval.status,
          by: result.approval.decided_by,
        });
      }
      res.json({ ok: true, approval: result.approval });
    });
  }

  // The demo situations, so the browser build and a running service offer the
  // same buttons and the same outcomes.
  app.get('/api/scenarios', (req, res) => {
    res.json(scenarios.map(({ key, title, blurb, expect }) => ({ key, title, blurb, expect })));
  });

  app.post('/api/scenarios/:key', async (req, res) => {
    const scenario = byKey[req.params.key];
    if (!scenario) return res.status(404).json({ error: `no scenario "${req.params.key}"` });
    try {
      const result = await scenario.run({ db, queue, gate, worker, connectors });
      res.json({ ok: true, scenario: scenario.key, result: result ?? null });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.use(express.static(staticDir));
  return app;
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return text; }
}

module.exports = { createServer };
