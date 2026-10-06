import * as db from './db.js';

const KINDS = { quote: 'Quote', verse: 'Verse', prayer: 'Prayer' };
const MAX_CHARS = 2000;
const RELOCK_AFTER_MS = 5 * 60 * 1000;

const app = document.getElementById('app');
const state = {
  screen: 'pin',       // pin | daily | feed | library
  overlay: null,       // null | compose | detail
  pin: '',
  pinError: false,
  pinMode: 'unlock',   // unlock | create | confirm
  pinFirst: '',
  daily: null,
  activeId: null,
  confirmDelete: false,
  filter: { kind: '', q: '' },
  compose: { kind: 'quote', body: '', reference: '' },
};

// ---------- Helpers ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const parseUtc = (s) => new Date(s.replace(' ', 'T') + 'Z');

function ago(s) {
  if (!s) return '';
  const sec = (Date.now() - parseUtc(s)) / 1000;
  if (sec < 60) return 'now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  if (sec < 86400 * 7) return `${Math.floor(sec / 86400)}d`;
  return parseUtc(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

async function hashPin(pin) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`nuggets:${pin}`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function toast(msg) {
  document.querySelector('.toast')?.remove();
  app.insertAdjacentHTML('beforeend', `<div class="toast">${esc(msg)}</div>`);
  setTimeout(() => document.querySelector('.toast')?.remove(), 1800);
}

const avatar = (e, size = '') => `<div class="avatar ${size} k-${e.kind}">${KINDS[e.kind][0]}</div>`;
const nugToggle = (e, label) =>
  `<button class="nug-toggle ${e.is_nugget ? 'on' : ''}" data-nug="${e.id}"><i></i>${label ?? (e.is_nugget ? 'Nugget' : 'Add to nuggets')}</button>`;

// ---------- Screens ----------

function pinView() {
  const label = { unlock: 'Enter your PIN', create: 'Create a 4-digit PIN', confirm: 'Confirm your PIN' }[state.pinMode];
  const msg = state.pinError
    ? (state.pinMode === 'unlock' ? 'Incorrect PIN, try again' : "PINs didn't match, start again")
    : (state.pinMode === 'unlock' ? '' : 'You will use this to open Nuggets');
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'];
  return `
    <div class="screen pin">
      <div class="pin-brand"><div class="mark lg">n</div><span class="wordmark lg">nuggets</span></div>
      <div class="pin-entry">
        <span class="pin-label ${state.pinError ? 'error' : ''}">${label}</span>
        <div class="dots ${state.pinError ? 'error' : ''}">
          ${[0, 1, 2, 3].map((i) => `<div class="dot ${i < state.pin.length ? 'on' : ''}"></div>`).join('')}
        </div>
        <span class="pin-msg ${state.pinError ? 'error' : ''}">${esc(msg)}</span>
      </div>
      <div class="keypad">
        ${keys.map((k) => k === ''
          ? '<button class="key hidden" aria-hidden="true"></button>'
          : k === 'back'
            ? '<button class="key ghost" data-key="back" aria-label="Delete">⌫</button>'
            : `<button class="key" data-key="${k}">${k}</button>`).join('')}
      </div>
    </div>`;
}

function dailyView() {
  const e = state.daily;
  const date = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const size = !e ? '' : e.body.length > 420 ? 'sm' : e.body.length > 160 ? 'md' : '';
  return `
    <div class="screen daily">
      <div class="daily-top"><div class="mark">n</div><span class="daily-date">${esc(date)}</span></div>
      <div class="daily-body">
        ${e ? `
          <span class="eyebrow">Today's nugget · ${KINDS[e.kind]}</span>
          ${e.title ? `<span class="byline-name">${esc(e.title)}</span>` : ''}
          <span class="daily-text ${size}">${esc(e.body)}</span>
          ${e.scripture ? `<span class="scripture">“${esc(e.scripture)}”</span>` : ''}
          <div class="byline">${avatar(e, 'xs')}<span class="byline-name">${esc(e.reference || KINDS[e.kind])}</span></div>
          <div class="daily-tools">
            <button class="chip-btn ${e.is_nugget ? 'on' : ''}" data-act="daily-nug">${e.is_nugget ? '● In nuggets' : '○ Add to nuggets'}</button>
            <button class="chip-btn" data-act="shuffle">↻ Another</button>
          </div>`
        : `<div class="empty"><b>Your library is empty</b>Import your Nuggets file (nuggets-private.db) to load your quotes, verses and prayers, or tap View nuggets and + to write your own.
            <div style="margin-top:18px"><button class="chip-btn" data-act="import">Import file</button></div></div>`}
      </div>
      <div class="stack">
        <button class="pill solid" data-act="feed">View nuggets</button>
        <button class="pill" data-act="lock">Close</button>
      </div>
    </div>`;
}

function rowView(e, { showNugToggle = true } = {}) {
  return `
    <div class="row" data-open="${e.id}">
      ${avatar(e)}
      <div class="row-main">
        <div class="row-meta">
          <span class="row-name">${esc(e.title || KINDS[e.kind])}</span>
          ${e.reference ? `<span class="row-handle">${esc(e.reference)}</span>` : ''}
          ${e.nugget_at && state.screen === 'feed' ? `<span class="row-time">· ${ago(e.nugget_at)}</span>` : ''}
        </div>
        <span class="row-text clamp">${esc(e.body)}</span>
        ${showNugToggle ? `<div class="row-actions">${nugToggle(e)}</div>` : ''}
      </div>
    </div>`;
}

function feedView() {
  const list = db.nuggets();
  return `
    <div class="scroll">
      ${list.length ? list.map((e) => rowView(e)).join('') : `
        <div class="empty"><b>No nuggets yet</b>Mark a quote, verse or prayer as a nugget and it will show up here.
        Tap <b style="display:inline;font-size:inherit">+</b> to write your own.</div>`}
    </div>
    <button class="fab" data-act="compose" aria-label="New nugget">+</button>`;
}

function libraryListView() {
  const list = db.library(state.filter);
  return list.length ? list.map((e) => rowView(e)).join('') : '<div class="empty">Nothing matches.</div>';
}

function statsView() {
  const s = db.stats();
  return `
    <div class="stats">
      <span><b>${s.total}</b> entries</span><span><b>${s.nuggets}</b> nuggets</span>
      <span><b>${s.quote}</b> quotes</span><span><b>${s.verse}</b> verses</span><span><b>${s.prayer}</b> prayers</span>
    </div>`;
}

function libraryView() {
  const chips = [['', 'All'], ...Object.entries(KINDS).map(([k, v]) => [k, v + 's'])];
  return `
    <div class="scroll">
      <div class="lib-head">
        ${statsView()}
        <input class="search" type="search" placeholder="Search" value="${esc(state.filter.q)}" data-input="search">
        <div class="chips">
          ${chips.map(([k, v]) => `<button class="chip ${state.filter.kind === k ? 'on' : ''}" data-kind-filter="${k}">${v}</button>`).join('')}
        </div>
        <div class="tools">
          <button class="tool" data-act="export">Export backup</button>
          <button class="tool" data-act="import">Import backup</button>
          <button class="tool" data-act="change-pin">Change PIN</button>
        </div>
      </div>
      <div id="lib-list">${libraryListView()}</div>
    </div>
    <button class="fab" data-act="compose" aria-label="New entry">+</button>`;
}

function shellView() {
  const isFeed = state.screen === 'feed';
  return `
    <div class="screen">
      <div class="header">
        <div class="brand"><div class="mark">n</div><span class="wordmark">${isFeed ? 'nuggets' : 'Library'}</span></div>
        <button class="icon-btn" data-act="today" aria-label="Random nugget">↻</button>
      </div>
      ${isFeed ? feedView() : libraryView()}
      <nav class="nav">
        <button class="${isFeed ? 'on' : ''}" data-act="feed"><i class="i-home"></i>Nuggets</button>
        <button class="${isFeed ? '' : 'on'}" data-act="library"><i class="i-lib"></i>Library</button>
      </nav>
    </div>`;
}

function composeView() {
  const c = state.compose;
  const left = MAX_CHARS - c.body.length;
  return `
    <div class="overlay">
      <div class="bar">
        <button class="link" data-act="close-overlay">Cancel</button>
        <button class="post" data-act="post" ${c.body.trim() ? '' : 'disabled'}>Post</button>
      </div>
      <div class="compose-body">
        <div class="chips">
          ${Object.entries(KINDS).map(([k, v]) => `<button class="chip ${c.kind === k ? 'on' : ''}" data-compose-kind="${k}">${v}</button>`).join('')}
        </div>
        <textarea data-input="body" maxlength="${MAX_CHARS}" placeholder="What's a nugget worth sharing?">${esc(c.body)}</textarea>
        <input class="field" data-input="reference" placeholder="Reference or author (optional), e.g. Psalm 23:1" value="${esc(c.reference)}">
      </div>
      <div class="compose-foot ${left < 20 ? 'low' : ''}">${left}</div>
    </div>`;
}

function detailView() {
  const e = db.getEntry(state.activeId);
  if (!e) return '';
  return `
    <div class="overlay">
      <div class="bar"><button class="back" data-act="close-overlay" aria-label="Back">←</button><span class="bar-title">${KINDS[e.kind]}</span></div>
      <div class="detail">
        <div class="who">${avatar(e, 'lg')}
          <div><span class="who-name">${esc(e.title || KINDS[e.kind])}</span><span class="who-handle">${esc(e.reference || '')}</span></div>
        </div>
        <span class="detail-text ${e.body.length > 420 ? 'sm' : ''}">${esc(e.body)}</span>
        ${e.scripture ? `<span class="scripture">“${esc(e.scripture)}”</span>` : ''}
        <span class="detail-time">Added ${parseUtc(e.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} · shown ${e.shown_count}×</span>
        <div class="chips">
          ${Object.entries(KINDS).map(([k, v]) => `<button class="chip ${e.kind === k ? 'on' : ''}" data-set-kind="${k}">${v}</button>`).join('')}
        </div>
        <div class="detail-actions">
          ${nugToggle(e, e.is_nugget ? 'In nuggets' : 'Add to nuggets')}
          <button class="danger" data-act="delete">${state.confirmDelete ? 'Tap again to delete' : 'Delete'}</button>
        </div>
      </div>
    </div>`;
}

function render() {
  const base = state.screen === 'pin' ? pinView() : state.screen === 'daily' ? dailyView() : shellView();
  const overlay = state.overlay === 'compose' ? composeView() : state.overlay === 'detail' ? detailView() : '';
  const scroll = app.querySelector('.scroll')?.scrollTop;
  app.innerHTML = base + overlay;
  if (scroll && !state.overlay) { const el = app.querySelector('.scroll'); if (el) el.scrollTop = scroll; }
}

// ---------- Actions ----------

function go(screen) {
  if (state.overlay) closeOverlay();
  state.screen = screen;
  render();
}

function lock() {
  Object.assign(state, { screen: 'pin', overlay: null, pin: '', pinError: false, pinMode: db.getSetting('pin_hash') ? 'unlock' : 'create' });
  render();
}

function openOverlay(name, extra = {}) {
  Object.assign(state, { overlay: name, confirmDelete: false }, extra);
  history.pushState({ overlay: name }, '');
  render();
  if (name === 'compose') app.querySelector('textarea')?.focus();
}

function closeOverlay() {
  state.overlay = null;
  if (history.state?.overlay) history.back();
  render();
}

window.addEventListener('popstate', () => {
  if (state.overlay) { state.overlay = null; render(); }
});

async function pressKey(k) {
  if (state.pinError) return;
  if (k === 'back') { state.pin = state.pin.slice(0, -1); return render(); }
  if (state.pin.length >= 4) return;
  state.pin += k;
  render();
  if (state.pin.length < 4) return;

  const pin = state.pin;
  const fail = () => {
    state.pinError = true;
    render();
    setTimeout(() => {
      Object.assign(state, { pin: '', pinError: false });
      if (state.pinMode === 'confirm') state.pinMode = 'create';
      render();
    }, 700);
  };

  if (state.pinMode === 'create') {
    Object.assign(state, { pinFirst: pin, pin: '', pinMode: 'confirm' });
    return setTimeout(render, 150);
  }
  if (state.pinMode === 'confirm') {
    if (pin !== state.pinFirst) return fail();
    db.setSetting('pin_hash', await hashPin(pin));
    state.pinFirst = '';
    return unlock();
  }
  if ((await hashPin(pin)) === db.getSetting('pin_hash')) unlock();
  else fail();
}

function unlock() {
  Object.assign(state, { screen: 'daily', pin: '', pinMode: 'unlock', daily: db.pickRandom() });
  setTimeout(render, 150);
}

function toggleNugget(id) {
  const e = db.getEntry(id);
  db.setNugget(id, !e.is_nugget);
  if (state.daily?.id === id) state.daily = db.getEntry(id);
  if (state.screen === 'library' && !state.overlay) {
    // Update just the button so the list doesn't jump.
    app.querySelectorAll(`[data-nug="${id}"]`).forEach((b) => b.outerHTML = nugToggle(db.getEntry(id)));
    app.querySelector('.stats').outerHTML = statsView();
    return;
  }
  render();
  toast(e.is_nugget ? 'Removed from nuggets' : 'Added to nuggets');
}

function postEntry() {
  const c = state.compose;
  const body = c.body.trim();
  if (!body) return;
  db.addEntry({ kind: c.kind, body, reference: c.reference.trim() });
  state.compose = { kind: c.kind, body: '', reference: '' };
  state.screen = 'feed';
  closeOverlay();
  toast('Posted to nuggets');
}

function exportBackup() {
  const blob = new Blob([db.exportBytes()], { type: 'application/x-sqlite3' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `nuggets-${new Date().toISOString().slice(0, 10)}.db`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function importBackup() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.db,.sqlite,application/x-sqlite3,application/octet-stream';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      await db.importBytes(new Uint8Array(await file.arrayBuffer()));
      toast('Backup restored');
      if (state.screen === 'daily') state.daily = db.pickRandom();
      render();
    } catch {
      toast("That file isn't a Nuggets backup");
    }
  };
  input.click();
}

const ACTIONS = {
  feed: () => go('feed'),
  library: () => go('library'),
  lock,
  today: () => { state.daily = db.pickRandom(state.daily?.id); go('daily'); },
  shuffle: () => { state.daily = db.pickRandom(state.daily?.id); render(); },
  'daily-nug': () => toggleNugget(state.daily.id),
  compose: () => openOverlay('compose'),
  'close-overlay': closeOverlay,
  post: postEntry,
  delete: () => {
    if (!state.confirmDelete) { state.confirmDelete = true; return render(); }
    db.deleteEntry(state.activeId);
    closeOverlay();
    toast('Deleted');
  },
  export: exportBackup,
  import: importBackup,
  'change-pin': () => { db.setSetting('pin_hash', ''); lock(); },
};

app.addEventListener('click', (ev) => {
  const t = ev.target.closest('[data-key],[data-act],[data-nug],[data-open],[data-kind-filter],[data-compose-kind],[data-set-kind]');
  if (!t) return;
  const d = t.dataset;
  if (d.key) return pressKey(d.key);
  if (d.nug) return toggleNugget(Number(d.nug));
  if (d.act) return ACTIONS[d.act]?.();
  if (d.open) return openOverlay('detail', { activeId: Number(d.open) });
  if (d.kindFilter !== undefined) { state.filter.kind = d.kindFilter; return render(); }
  if (d.composeKind) {
    state.compose.kind = d.composeKind;
    app.querySelectorAll('[data-compose-kind]').forEach((b) => b.classList.toggle('on', b === t));
    return;
  }
  if (d.setKind) { db.setKind(state.activeId, d.setKind); render(); }
});

// Text inputs update in place so typing never loses focus.
app.addEventListener('input', (ev) => {
  const field = ev.target.dataset.input;
  if (field === 'search') {
    state.filter.q = ev.target.value.trim();
    document.getElementById('lib-list').innerHTML = libraryListView();
  } else if (field === 'body' || field === 'reference') {
    state.compose[field] = ev.target.value;
    if (field === 'body') {
      ev.target.style.height = 'auto';
      ev.target.style.height = `${ev.target.scrollHeight}px`;
      const left = MAX_CHARS - ev.target.value.length;
      const foot = app.querySelector('.compose-foot');
      foot.textContent = left;
      foot.classList.toggle('low', left < 20);
      app.querySelector('.post').disabled = !ev.target.value.trim();
    }
  }
});

// Physical keyboard support on the PIN screen.
document.addEventListener('keydown', (ev) => {
  if (state.screen !== 'pin') return;
  if (/^[0-9]$/.test(ev.key)) pressKey(ev.key);
  else if (ev.key === 'Backspace') pressKey('back');
});

// Re-lock when the app comes back after a while, so each "open" shows a fresh nugget.
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); db.saveNow(); return; }
  if (hiddenAt && Date.now() - hiddenAt > RELOCK_AFTER_MS && state.screen !== 'pin') lock();
});

// ---------- Boot ----------

await db.openDb();
lock();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
