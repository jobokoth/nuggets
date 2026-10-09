// SQLite (sql.js / WebAssembly) database for the app.
// The first launch loads the seed database shipped as nuggets.db; after that
// the whole database file is kept in IndexedDB and re-saved after every write.

const IDB_NAME = 'nuggets';
const IDB_STORE = 'files';
const IDB_KEY = 'nuggets.db';

let db;
let saveTimer;

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbRun(mode, fn) {
  const conn = await idb();
  return new Promise((resolve, reject) => {
    const tx = conn.transaction(IDB_STORE, mode);
    const req = fn(tx.objectStore(IDB_STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
  });
}

export async function openDb() {
  const SQL = await window.initSqlJs({ locateFile: (f) => `vendor/${f}` });
  let bytes = await idbRun('readonly', (s) => s.get(IDB_KEY)).catch(() => null);
  const fresh = !bytes;
  if (fresh) bytes = new Uint8Array(await (await fetch('nuggets.db')).arrayBuffer());
  db = new SQL.Database(bytes);
  if (fresh) await saveNow();
  if ('storage' in navigator && navigator.storage.persist) navigator.storage.persist();
}

export function saveNow() {
  clearTimeout(saveTimer);
  return idbRun('readwrite', (s) => s.put(db.export(), IDB_KEY));
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 250);
}

export function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

export const one = (sql, params) => all(sql, params)[0] || null;

export function run(sql, params = []) {
  db.run(sql, params);
  scheduleSave();
}

// ---------- Queries ----------

// Round-robin random: pick randomly among the entries shown the fewest times,
// so every entry comes up once before any repeats.
export function pickRandom(excludeId = 0) {
  const e = one(
    'SELECT * FROM entries WHERE id != ? ORDER BY shown_count, random() LIMIT 1',
    [excludeId]
  ) || one('SELECT * FROM entries ORDER BY random() LIMIT 1');
  if (e) run("UPDATE entries SET shown_count = shown_count + 1, last_shown_at = datetime('now') WHERE id = ?", [e.id]);
  return e;
}

export const getEntry = (id) => one('SELECT * FROM entries WHERE id = ?', [id]);

// One pinned entry at a time; it opens the app on every unlock until unpinned.
export const pinnedId = () => Number(getSetting('pinned_id')) || 0;
export const setPinned = (id) => setSetting('pinned_id', id ? String(id) : '');
export const getPinned = () => (pinnedId() && getEntry(pinnedId())) || null;

export const nuggets = () =>
  all('SELECT * FROM entries WHERE is_nugget = 1 ORDER BY nugget_at DESC, id DESC');

export function library({ kind, q }) {
  const where = [];
  const params = [];
  if (kind) { where.push('kind = ?'); params.push(kind); }
  if (q) {
    where.push("(body LIKE ? ESCAPE '\\' OR reference LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' OR scripture LIKE ? ESCAPE '\\')");
    const like = `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
    params.push(like, like, like, like);
  }
  const sql = `SELECT * FROM entries ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC`;
  return all(sql, params);
}

export function stats() {
  const s = { total: 0, nuggets: 0, quote: 0, verse: 0, prayer: 0 };
  for (const r of all('SELECT kind, COUNT(*) AS n, SUM(is_nugget) AS nug FROM entries GROUP BY kind')) {
    s[r.kind] = r.n;
    s.total += r.n;
    s.nuggets += r.nug || 0;
  }
  return s;
}

export function setNugget(id, on) {
  run(
    `UPDATE entries SET is_nugget = ?, nugget_at = ${on ? "datetime('now')" : 'NULL'} WHERE id = ?`,
    [on ? 1 : 0, id]
  );
}

export const setKind = (id, kind) => run('UPDATE entries SET kind = ? WHERE id = ?', [kind, id]);

export function deleteEntry(id) {
  if (pinnedId() === id) setPinned(0);
  run('DELETE FROM entries WHERE id = ?', [id]);
}

export function addEntry({ kind, body, reference }) {
  run(
    "INSERT INTO entries (kind, body, reference, is_nugget, nugget_at) VALUES (?, ?, ?, 1, datetime('now'))",
    [kind, body, reference || null]
  );
}

export function updateEntry(id, { kind, title, body, reference, scripture }) {
  run(
    'UPDATE entries SET kind = ?, title = ?, body = ?, reference = ?, scripture = ? WHERE id = ?',
    [kind, title || null, body, reference || null, scripture || null, id]
  );
}

export const getSetting = (key) => one('SELECT value FROM settings WHERE key = ?', [key])?.value ?? null;

export function setSetting(key, value) {
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
}

// ---------- Backup ----------

export const exportBytes = () => db.export();

export async function importBytes(bytes) {
  const SQL = await window.initSqlJs({ locateFile: (f) => `vendor/${f}` });
  const next = new SQL.Database(bytes);
  next.exec('SELECT id, kind, body, is_nugget FROM entries LIMIT 1'); // throws if not a Nuggets DB
  // Keep the current PIN unless the backup brings its own (e.g. a fresh export from the seed has none).
  const pin = getSetting('pin_hash');
  const hasPin = next.exec("SELECT value FROM settings WHERE key = 'pin_hash' AND value != ''")[0];
  if (pin && !hasPin) {
    next.run("INSERT INTO settings (key, value) VALUES ('pin_hash', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [pin]);
  }
  // A fingerprint credential only exists on the phone that made it, so always keep this device's.
  next.run("INSERT INTO settings (key, value) VALUES ('fingerprint', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [getSetting('fingerprint') || '']);
  db.close();
  db = next;
  await saveNow();
}
