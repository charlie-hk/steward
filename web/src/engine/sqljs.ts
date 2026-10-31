import initSqlJs, { type Database as SqlJsDatabase, type SqlValue } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

/**
 * A better-sqlite3-shaped face over sql.js.
 *
 * The point of this file is that nothing above it has to know. The engine in
 * `src/` is written against better-sqlite3's synchronous `prepare().get/all/run`
 * API, and sql.js is SQLite compiled to WebAssembly with a different shape, so
 * one adapter here lets the browser run the real queue, the real gate and the
 * real policy instead of a second implementation of them that would drift.
 */

type Params = unknown[];

export interface SqliteLike {
  prepare(sql: string): Statement;
  exec(sql: string): void;
  pragma(statement: string): unknown[];
  transaction<T extends (...args: never[]) => unknown>(fn: T): T;
  close(): void;
  export(): Uint8Array;
}

interface Statement {
  run(...params: Params): { changes: number; lastInsertRowid: number };
  get(...params: Params): Record<string, unknown> | undefined;
  all(...params: Params): Record<string, unknown>[];
}

let ready: Promise<Awaited<ReturnType<typeof initSqlJs>>> | null = null;

export function loadSqlJs() {
  if (!ready) ready = initSqlJs({ locateFile: () => wasmUrl });
  return ready;
}

export async function openBrowserDb(): Promise<SqliteLike> {
  const SQL = await loadSqlJs();
  return wrapSqlJs(new SQL.Database());
}

// Exported so the test suite can wrap a database it created itself, without a
// browser and without the WebAssembly loader.
export function wrapSqlJs(db: SqlJsDatabase): SqliteLike {
  // sql.js rejects undefined as a bound value, and the engine passes undefined
  // for an absent optional column. Null is what the column means anyway.
  const bind = (params: Params) => params.map((p) => (p === undefined ? null : p)) as SqlValue[];

  const api: SqliteLike = {
    prepare(sql: string): Statement {
      return {
        run(...params: Params) {
          const stmt = db.prepare(sql);
          try {
            stmt.bind(bind(params));
            stmt.step();
          } finally {
            stmt.free();
          }
          const changes = db.getRowsModified();
          const [row] = db.exec('SELECT last_insert_rowid() AS id');
          return { changes, lastInsertRowid: Number(row?.values?.[0]?.[0] ?? 0) };
        },
        get(...params: Params) {
          const stmt = db.prepare(sql);
          try {
            stmt.bind(bind(params));
            return stmt.step() ? (stmt.getAsObject() as Record<string, unknown>) : undefined;
          } finally {
            stmt.free();
          }
        },
        all(...params: Params) {
          const stmt = db.prepare(sql);
          const rows: Record<string, unknown>[] = [];
          try {
            stmt.bind(bind(params));
            while (stmt.step()) rows.push(stmt.getAsObject() as Record<string, unknown>);
          } finally {
            stmt.free();
          }
          return rows;
        },
      };
    },

    exec(sql: string) {
      db.run(sql);
    },

    // Journal mode and foreign keys are meaningless against an in-memory
    // database in a tab, but the call has to succeed: the schema code is shared.
    pragma(statement: string) {
      try {
        const result = db.exec(`PRAGMA ${statement}`);
        if (!result.length) return [];
        const [{ columns, values }] = result;
        return values.map((row) => Object.fromEntries(row.map((v, i) => [columns[i], v])));
      } catch {
        return [];
      }
    },

    transaction<T extends (...args: never[]) => unknown>(fn: T): T {
      return ((...args: never[]) => {
        db.run('BEGIN');
        try {
          const result = fn(...args);
          db.run('COMMIT');
          return result;
        } catch (err) {
          db.run('ROLLBACK');
          throw err;
        }
      }) as T;
    },

    close() { db.close(); },
    export() { return db.export(); },
  };

  return api;
}
