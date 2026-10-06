// Builds the two SQLite databases:
//   public/nuggets.db           empty (schema only). Shipped with the app, so safe to host publicly.
//   private/nuggets-private.db  your entries from the quotes text file. Never deployed or committed;
//                               load it on the phone with Library -> Import backup.
import { mkdirSync, writeFileSync } from 'node:fs';
import initSqlJs from 'sql.js';
import { parseQuotes } from './parse-quotes.mjs';

const SOURCE = process.argv[2] || '_RESOURCES/QUOTES ROUNDROBIN.txt';
const PUBLIC_DB = 'public/nuggets.db';
const PRIVATE_DB = 'private/nuggets-private.db';

const SCHEMA = `
CREATE TABLE entries (
  id            INTEGER PRIMARY KEY,
  kind          TEXT    NOT NULL CHECK (kind IN ('quote', 'verse', 'prayer')),
  title         TEXT,
  body          TEXT    NOT NULL,
  reference     TEXT,
  scripture     TEXT,
  is_nugget     INTEGER NOT NULL DEFAULT 0,
  nugget_at     TEXT,
  shown_count   INTEGER NOT NULL DEFAULT 0,
  last_shown_at TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX entries_nugget_idx ON entries (is_nugget, nugget_at);
CREATE INDEX entries_shown_idx ON entries (shown_count);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
`;

const SQL = await initSqlJs();

function newDb() {
  const db = new SQL.Database();
  db.run(SCHEMA);
  db.run("INSERT INTO settings (key, value) VALUES ('seed_version', ?)", [String(Date.now())]);
  return db;
}

// Public: schema only.
writeFileSync(PUBLIC_DB, Buffer.from(newDb().export()));
console.log(`Wrote ${PUBLIC_DB} (empty, safe to publish)`);

// Private: all entries.
const db = newDb();
const entries = parseQuotes(SOURCE);
const insert = db.prepare(
  'INSERT INTO entries (kind, title, body, reference, scripture) VALUES (?, ?, ?, ?, ?)'
);
db.run('BEGIN');
for (const e of entries) {
  insert.run([e.kind, e.title || null, e.body, e.reference || null, e.scripture || null]);
}
db.run('COMMIT');
insert.free();

mkdirSync('private', { recursive: true });
writeFileSync(PRIVATE_DB, Buffer.from(db.export()));
const counts = db.exec('SELECT kind, COUNT(*) FROM entries GROUP BY kind')[0].values;
console.log(`Wrote ${PRIVATE_DB} with ${entries.length} entries:`, Object.fromEntries(counts));
