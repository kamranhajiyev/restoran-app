// The till's own database, on the restaurant's PC.
//
// This is what makes the desktop app work with the cable unplugged. The till
// reads and writes here and nowhere else; the outbox carries the result to
// Supabase later, on its own time. Nothing the waiter does waits for a network.
//
// The tables and everything that reads and writes them are shared with the
// Android app, in lib/till-store/. This file only opens the file on Windows.

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { attachDb, type SqlHandle } from '../lib/till-store/db';

export { db, docs, getMeta, setMeta, transact } from '../lib/till-store/db';

let _opened: SqlHandle | null = null;

export function openDb(userDataDir: string): SqlHandle {
  if (_opened) return _opened;

  const handle = new DatabaseSync(path.join(userDataDir, 'till.db'));

  // A restaurant loses power; that is usually *why* the line went down. WAL
  // plus a real fsync at each commit is the difference between losing the last
  // order and losing the file.
  handle.exec('pragma journal_mode = wal');
  handle.exec('pragma synchronous = full');
  handle.exec('pragma foreign_keys = on');

  _opened = attachDb(handle);
  return _opened;
}
