// The browser build never opens a file-backed database, so the native driver
// is replaced by something that says so loudly if anything tries.
export default function Database(): never {
  throw new Error('better-sqlite3 is not available in the browser; use openBrowserDb()');
}
