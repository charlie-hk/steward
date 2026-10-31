# The Steward panel

React, Vite, TypeScript in strict mode, Tailwind. It shows the queue, what is
waiting for a person and why, the draft when a model wrote one, the policy, the
jobs and the audit log, and it decides approvals.

**Live:** https://charlie-hk.github.io/steward/

## Two ways it runs, one build

```bash
cd web
npm install
npm run dev            # http://localhost:5173
npm run build          # type check, then build into ../docs
npm test               # 9 tests
```

The build is written to `../docs`, which is both what GitHub Pages serves and
what the Node service serves, so there is one panel rather than two that drift.
Asset paths are relative, which is what lets the same bundle work at a Pages
sub-path and at the root of the service.

At startup the panel asks whether a service is answering at `/api`:

- **A service is there** - it talks to the Express API in `src/server.js`.
- **Nothing is there**, as on GitHub Pages - it runs the engine in the tab.

`?demo` forces the second even when a service is up.

## The engine in the tab

This is the part worth explaining, because the usual way to demonstrate a
backend without a backend is to write a mock of it, and a mock always agrees
with whatever its author believed on the day.

There is no mock here. `src/api/local.ts` imports the real `queue.js`,
`worker.js`, `gate.js`, `policy.js`, the real connectors and the real drafting
step from `../src`, the same files the service runs. The only substitution is
the database: `src/engine/sqljs.ts` is roughly a hundred lines that give
SQLite-compiled-to-WebAssembly the shape better-sqlite3 has, so the engine
cannot tell the difference.

What that buys: if a rule changes, the demo changes with it, and if the engine
is wrong, the demo is wrong in the same way instead of looking fine. The two
risks it adds are the adapter being subtly wrong and the schema diverging, so
`src/test/engine-in-browser.test.ts` runs the real engine on that adapter and
checks the things that would break first: inserted ids and row counts, a
transaction that rolls back, a held payment that runs once on approval and
never on rejection, a crash mid-job that does not issue the invoice twice, and
the idempotency key surviving the round trip.

Two honest limits. Everything is in memory, so reloading the page starts from
nothing. And the worker loop is a timer in the tab rather than a service, so a
background tab is throttled by the browser and the queue moves more slowly
while you are not looking.

## Layout

```
src/engine/sqljs.ts     better-sqlite3's shape over SQLite in WebAssembly
src/api/local.ts        the engine, wired up in the browser
src/api/http.ts         the same interface against the Express API
src/api/index.ts        picks one at startup
src/components/         panels, all presentational
src/test/               the adapter, the engine on it, and the approvals UI
```
