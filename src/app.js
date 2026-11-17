import { generateCode, normalizeCode } from './code.js';
import { createBoard, addImported, setOrganiser, merge, nameConflict, actingOrganiser } from './board.js';
import { parseImport, toMarkdown, toJSON, download, day } from './export.js';
import { renderBoard } from './boardview.js';
import { connect } from './net.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const cleanName = (s) => String(s ?? '').trim().slice(0, 40);

const NOBODY = 'Nobody is in this session. It may have ended, or the code is mistyped.';
const nameTaken = (name) => `Someone called ${name} is already in this session. Pick another name, or close your other tab first.`;

const joinedAt = Date.now(); // once per page load

// Live session state. Task 7 reads it in render() and calls commit() after a local board op.
export const state = { code: null, me: null, board: null, present: [], net: null };

export function render() {
  show(state.board.columns.length ? 'board' : 'connecting');
  $('#connecting-code').textContent = state.code;
  $('#board-code').textContent = state.code;
  if (state.board.columns.length) renderBoard(state, commit);
}

export function commit() {
  state.net?.broadcast(state.board); // net is null while retrying a name conflict
  render();
}

function show(id) {
  for (const s of $$('main > section')) s.hidden = s.id !== id;
}

// ---- theme ----
const osDark = matchMedia('(prefers-color-scheme: dark)');
function themeIcons() {
  const dark = (document.documentElement.dataset.theme || (osDark.matches ? 'dark' : 'light')) === 'dark';
  for (const b of $$('.theme-toggle')) {
    b.textContent = dark ? '☀' : '☾';
    b.setAttribute('aria-label', dark ? 'Switch to whiteboard' : 'Switch to blackboard');
  }
}
export function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('retro.theme', t); } catch { /* preference only */ }
  themeIcons();
}
try {
  const t = localStorage.getItem('retro.theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch { /* storage blocked: follow the OS */ }
osDark.addEventListener('change', themeIcons);
for (const b of $$('.theme-toggle')) b.addEventListener('click', () => setTheme(b.textContent === '☾' ? 'dark' : 'light'));
themeIcons();

// ---- session / connection ----
let timers = [];
const later = (ms, f) => timers.push(setTimeout(f, ms));

function stop() {
  timers.forEach(clearTimeout);
  timers = [];
  state.net?.leave();
  state.net = null;
  state.present = []; // no session: the leave-site warning must not fire
  $('#cleared').hidden = true;
}

function sanitizePeers(list) {
  return (Array.isArray(list) ? list : []).flatMap((p) => {
    const name = typeof p?.name === 'string' ? cleanName(p.name) : '';
    return name && Number.isFinite(p.joinedAt) ? [{ name, joinedAt: p.joinedAt, peerId: p.peerId }] : [];
  });
}

function open() {
  const net = connect({
    code: state.code,
    onBoard(data) {
      if (net !== state.net) return;
      const before = JSON.stringify(state.board);
      merge(state.board, data);
      // pass changes on, so every peer holds the latest board for newcomers; stops once boards agree
      if (JSON.stringify(state.board) !== before) net.broadcast(state.board);
      render();
    },
    onPresence(list) {
      if (net !== state.net) return;
      const peers = sanitizePeers(list), self = { ...state.me, peerId: net.selfId };
      state.present = [...peers, self];
      // Names come only from hellos other tabs send us; a closed (reloaded) tab sends none,
      // so a clash is always a real other person: fail right away, no retrying.
      if (nameConflict(self, peers)) return fail(nameTaken(state.me.name));
      render();
    },
  });
  state.net = net;
  state.present = [{ ...state.me, peerId: net.selfId }];
  net.announce(state.me);
  if (state.board.columns.length) net.broadcast(state.board);
}

function startSession(code, name, board) {
  stop();
  Object.assign(state, { code, me: { name, joinedAt }, board, present: [] });
  location.hash = new URLSearchParams({ code, name });
  open();
  render();
  if (!board.columns.length) {
    const giveUp = () => { if (!state.board.columns.length) fail(NOBODY); };
    // someone said hello: allow one extension for a slow board transfer
    later(10000, () => (state.present.length > 1 ? later(5000, giveUp) : giveUp()));
  }
}

function fail(msg) {
  stop();
  history.replaceState(null, '', `#code=${state.code}`); // drop the name so a refresh doesn't retry
  showJoin(state.code, state.me.name, msg);
}

// ---- join ----
function showJoin(code = '', name = savedName(), error = '') {
  $('#join-code').value = code;
  $('#join-name').value = name;
  $('#join-error').textContent = error;
  $('#join-error').hidden = !error;
  joinReady();
  show('join');
  $(code ? '#join-name' : '#join-code').focus();
}
const joinReady = () => { $('#join-go').disabled = !$('#join-code').value.trim() || !cleanName($('#join-name').value); };
$('#join-code').addEventListener('input', joinReady);
$('#join-name').addEventListener('input', joinReady);
$('#join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = normalizeCode($('#join-code').value), name = cleanName($('#join-name').value);
  if (!code) {
    $('#join-error').textContent = "That doesn't look like a session code.";
    $('#join-error').hidden = false;
    return;
  }
  if (name) { rememberName(name); startSession(code, name, createBoard([])); }
});

// ---- setup ----
let cols = [];
let imported = [];
try {
  const saved = JSON.parse(localStorage.getItem('retro.columns'));
  cols = Array.isArray(saved) ? saved.filter((s) => typeof s === 'string').map((s) => s.slice(0, 60)) : [];
} catch { cols = []; }

const keptCols = () => cols.map((c) => c.trim()).filter(Boolean);
const setupReady = () => { $('#start').disabled = !cleanName($('#setup-name').value) || !keptCols().length; };

function renderTargets() {
  const sel = $('#target-col'), prev = sel.value;
  sel.replaceChildren(...keptCols().map((c, i) => Object.assign(el('option', null, c), { value: i })));
  if (prev && +prev < sel.options.length) sel.value = prev;
  $('#import-target').hidden = !imported.length;
}

function renderCols(focusIndex) {
  const list = $('#col-list');
  list.replaceChildren(...cols.map((name, i) => {
    const row = el('div', 'colrow');
    const input = Object.assign(el('input', 'in'), { value: name, maxLength: 60 });
    input.setAttribute('aria-label', `Column ${i + 1} name`);
    input.addEventListener('input', () => { cols[i] = input.value; setupReady(); renderTargets(); });
    const btn = (label, aria, f) => {
      const b = el('button', 'btn sm', label);
      b.type = 'button';
      b.setAttribute('aria-label', aria);
      b.addEventListener('click', () => { f(); renderCols(); });
      return b;
    };
    const swap = (j) => { if (j >= 0 && j < cols.length) [cols[i], cols[j]] = [cols[j], cols[i]]; };
    row.append(el('span', 'stripe'), input,
      btn('↑', 'Move up', () => swap(i - 1)),
      btn('↓', 'Move down', () => swap(i + 1)),
      btn('✕', 'Remove column', () => cols.splice(i, 1)));
    return row;
  }));
  if (focusIndex != null) list.querySelectorAll('input')[focusIndex]?.focus();
  setupReady();
  renderTargets();
}

function setupError(msg) {
  $('#setup-error').textContent = msg;
  $('#setup-error').hidden = !msg;
}

$('#setup-name').addEventListener('input', setupReady);
$('#add-col').addEventListener('click', () => { cols.push(''); renderCols(cols.length - 1); });
$('#pick-file').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  $('#file-name').textContent = file.name;
  try {
    imported = parseImport(await file.text());
    setupError(imported.length ? '' : 'That file has no cards.');
  } catch (err) {
    imported = [];
    setupError(err.message);
  }
  $('#import-items').replaceChildren(...imported.map((item) => {
    const row = el('label', 'item');
    const box = Object.assign(el('input'), { type: 'checkbox' });
    box.addEventListener('change', () => { item.picked = box.checked; });
    row.append(box, el('span', null, item.text), el('span', 'who', item.author));
    return row;
  }));
  renderTargets();
});

// Only the Start session button starts a session; Enter in a field must not.
$('#setup-form').addEventListener('submit', (e) => e.preventDefault());
$('#start').addEventListener('click', () => {
  const name = cleanName($('#setup-name').value), kept = keptCols();
  if (!name || !kept.length) return;
  try { localStorage.setItem('retro.columns', JSON.stringify(kept)); } catch { /* not essential */ }
  const board = createBoard(kept);
  addImported(board, imported.filter((i) => i.picked), `c${$('#target-col').value || 0}`);
  setOrganiser(board, name);
  rememberName(name);
  startSession(generateCode(), name, board);
});

// ---- navigation ----
$('#go-start').addEventListener('click', () => {
  if (!$('#setup-name').value) $('#setup-name').value = savedName();
  renderCols();
  show('setup');
  $('#setup-name').focus();
});
$('#go-join').addEventListener('click', () => showJoin());
$('#connecting-back').addEventListener('click', stop);
for (const b of $$('.back')) {
  b.addEventListener('click', () => {
    history.replaceState(null, '', location.pathname + location.search);
    show('home');
  });
}
$('#copy-link').addEventListener('click', async (e) => {
  const b = e.currentTarget;
  try {
    await navigator.clipboard.writeText(`${location.origin}${location.pathname}#code=${state.code}`);
    b.textContent = 'Copied';
    setTimeout(() => { b.textContent = 'Copy link'; }, 1500);
  } catch {
    getSelection().selectAllChildren($('#board-code')); // clipboard blocked: select the code to copy by hand
  }
});
const exportAs = (ext, content, mime) => download(`retro-${day(new Date())}.${ext}`, content, mime);
$('#export-md').addEventListener('click', () => exportAs('md', toMarkdown(state.board, new Date()), 'text/markdown'));
$('#export-json').addEventListener('click', () => exportAs('json', toJSON(state.board, new Date()), 'application/json'));

// ---- names: remembered in this browser so you don't retype them ----
function savedName() { try { return cleanName(localStorage.getItem('retro.name') ?? ''); } catch { return ''; } }
function rememberName(name) { try { localStorage.setItem('retro.name', name); } catch { /* not essential */ } }

// ---- reloading: the board only lives in memory, so a reload keeps just what's needed to come back ----
// (code, column names, whether you were alone/organiser, whether there were cards — never card text)
addEventListener('pagehide', () => {
  if (!state.net || !state.board?.columns.length) return;
  const alone = state.present.length === 1;
  const info = {
    code: state.code,
    columns: state.board.columns.map((c) => c.name),
    organiser: actingOrganiser(state.board, state.present) === state.me.name,
    clearedCards: alone && Object.values(state.board.cards).some((c) => !c.deleted),
  };
  try { sessionStorage.setItem('retro.reload', JSON.stringify(info)); } catch { /* falls back to a normal join */ }
});

function rejoin(code, name) {
  let info = null;
  try { info = JSON.parse(sessionStorage.getItem('retro.reload')); sessionStorage.removeItem('retro.reload'); } catch { /* none */ }
  const ok = info && info.code === code && Array.isArray(info.columns) && info.columns.length &&
    info.columns.every((c) => typeof c === 'string');
  if (!ok) return startSession(code, name, createBoard([]));
  // Back on the board straight away; anyone still here sends their copy and merge fills it in.
  const board = createBoard(info.columns);
  if (info.organiser === true) setOrganiser(board, name);
  startSession(code, name, board);
  if (info.clearedCards === true) {
    // only say "cleared" if nobody brought the cards back
    later(10000, () => {
      const cardsBack = Object.values(state.board.cards).some((c) => !c.deleted);
      $('#cleared').hidden = cardsBack || state.present.length > 1;
    });
  }
}
$('#cleared-ok').addEventListener('click', () => { $('#cleared').hidden = true; });

// ---- leaving: the last tab holds the only copy ----
addEventListener('beforeunload', (e) => {
  if (state.board && state.present.length === 1 && Object.values(state.board.cards).some((c) => !c.deleted)) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ---- start: rejoin from the fragment, prefill the code, or show home ----
const hash = new URLSearchParams(location.hash.slice(1));
const hashCode = normalizeCode(hash.get('code') ?? ''), hashName = cleanName(hash.get('name'));
if (hashCode && hashName) rejoin(hashCode, hashName);
else if (hash.has('code')) showJoin(hashCode ?? hash.get('code'));
else show('home');
