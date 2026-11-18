const clean = (s, max) => String(s ?? '').trim().slice(0, max);
const live = (board, id) => {
  const c = Object.hasOwn(board.cards, id) ? board.cards[id] : null;
  return c && !c.deleted ? c : null;
};

export function createBoard(columns) {
  return {
    columns: columns.map((name, i) => ({ id: `c${i}`, name: clean(name, 60) })),
    cards: Object.create(null), // null prototype: peer-supplied keys like __proto__ stay plain keys
    revealed: Object.create(null), // author -> {on, rev}: last write wins, so a reveal can be undone
    organiser: { name: '', rev: 0 },
    helpers: Object.create(null), // name -> {on, rev}: extra organisers, same merge rule as votes
  };
}

export function addCard(board, { id, column, text, author }) {
  if (Object.hasOwn(board.cards, id) || !board.columns.some((c) => c.id === column)) return board;
  author = clean(author, 40);
  board.cards[id] = {
    id, column, text: clean(text, 1000), author,
    rev: 0, deleted: false, revealed: false, votes: Object.create(null), downs: Object.create(null),
  };
  return board;
}

// The author manages their card. While the author is away, the acting organiser manages their
// face-up cards; the author stays the author, so they get the cards back when they return.
export function manages(board, card, name, present = []) {
  return card.author === name || (isRevealed(board, card) &&
    !present.some((p) => p.name === card.author) && actingOrganiser(board, present) === name);
}

export function editCard(board, id, text, by, present) {
  const c = live(board, id);
  if (c && manages(board, c, by, present)) {
    c.text = clean(text, 1000);
    c.rev++;
  }
  return board;
}

export function deleteCard(board, id, by, present) {
  const c = live(board, id);
  if (c && manages(board, c, by, present)) {
    c.deleted = true;
    c.text = '';
    c.rev++;
  }
  return board;
}

// kind: 'votes' (👍) or 'downs' (👎); turning one on turns the other off
export function toggleVote(board, id, voter, kind = 'votes') {
  const c = live(board, id);
  if (c && voter !== c.author && isRevealed(board, c)) {
    const get = (k) => (Object.hasOwn(c[k], voter) ? c[k][voter] : (c[k][voter] = { on: false, rev: 0 }));
    const v = get(kind);
    v.on = !v.on;
    v.rev++;
    const other = get(kind === 'votes' ? 'downs' : 'votes');
    if (v.on && other.on) { other.on = false; other.rev++; }
  }
  return board;
}

// who may move: see canOrganise
export function moveCard(board, id, column) {
  const c = live(board, id);
  if (c && c.column !== column && board.columns.some((x) => x.id === column)) {
    c.column = column;
    c.rev++;
  }
  return board;
}

// card.revealed only pins imported cards face-up; everyone else follows their author's reveal state
export const shown = (board, author) => Object.hasOwn(board.revealed, author) && board.revealed[author].on;
export const isRevealed = (board, card) => card.revealed || shown(board, card.author);

function setShown(board, author, on) {
  const rev = Object.hasOwn(board.revealed, author) ? board.revealed[author].rev : 0;
  board.revealed[author] = { on, rev: rev + 1 };
  return board;
}
export const reveal = (board, author) => setShown(board, author, true);
export const hide = (board, author) => setShown(board, author, false);

export function setOrganiser(board, name) {
  board.organiser = { name: clean(name, 40), rev: board.organiser.rev + 1 };
  return board;
}

export function setHelper(board, name, on) {
  const rev = Object.hasOwn(board.helpers, name) ? board.helpers[name].rev : 0;
  board.helpers[name] = { on, rev: rev + 1 };
  return board;
}
export const isHelper = (board, name) => Object.hasOwn(board.helpers, name) && board.helpers[name].on;
// the acting organiser and helpers can reveal, hide and move cards
export const canOrganise = (board, name, present) => actingOrganiser(board, present) === name || isHelper(board, name);

export function addImported(board, items, column) {
  for (const { text, author } of items) {
    const id = crypto.randomUUID();
    addCard(board, { id, column, text, author });
    if (Object.hasOwn(board.cards, id)) board.cards[id].revealed = true;
  }
  return board;
}

export const voteCount = (card, kind = 'votes') => Object.values(card[kind]).filter((v) => v.on).length;

// ---- merge: remote is untrusted; everything copied is rebuilt into clean objects ----
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const isRev = (n) => Number.isInteger(n) && n >= 0;
const str = (s, max) => (typeof s === 'string' ? clean(s, max) : null);

function cleanVotes(raw) {
  const out = Object.create(null);
  if (!isObj(raw)) return out;
  for (const k of Object.keys(raw)) {
    const v = raw[k];
    if (k.length <= 40 && isObj(v) && typeof v.on === 'boolean' && isRev(v.rev)) out[k] = { on: v.on, rev: v.rev };
  }
  return out;
}

function cleanCard(id, raw, columns) {
  if (!isObj(raw) || raw.id !== id || id.length > 100) return null;
  const text = str(raw.text, 1000), author = str(raw.author, 40);
  if (text === null || author === null || !isRev(raw.rev)) return null;
  if (typeof raw.column !== 'string' || !columns.some((c) => c.id === raw.column)) return null;
  const deleted = raw.deleted === true;
  return {
    id, column: raw.column, text: deleted ? '' : text, author, rev: raw.rev,
    deleted, revealed: raw.revealed === true, votes: cleanVotes(raw.votes), downs: cleanVotes(raw.downs),
  };
}

// deleted is sticky (never resurrect), then higher rev, then larger text, then author/column for determinism
const order = (c) => [c.deleted ? 1 : 0, c.rev, c.text, c.author, c.column];
const better = (a, b) => {
  const x = order(a), y = order(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};

function mergeVotes(a, b) {
  const out = Object.create(null);
  for (const src of [a, b]) {
    for (const k of Object.keys(src)) {
      const v = src[k], o = out[k];
      if (!o || v.rev > o.rev || (v.rev === o.rev && !v.on && o.on)) out[k] = { on: v.on, rev: v.rev };
    }
  }
  return out;
}

export function merge(local, remote) {
  if (!isObj(remote)) return local;
  if (!local.columns.length && Array.isArray(remote.columns)) {
    const seen = new Set();
    for (const c of remote.columns) {
      const id = isObj(c) ? str(c.id, 60) : null, name = isObj(c) ? str(c.name, 60) : null;
      if (id && name !== null && !seen.has(id)) { seen.add(id); local.columns.push({ id, name }); }
    }
  }
  if (isObj(remote.cards)) {
    for (const id of Object.keys(remote.cards)) {
      const r = cleanCard(id, remote.cards[id], local.columns);
      if (!r) continue;
      const l = Object.hasOwn(local.cards, id) ? local.cards[id] : null;
      if (!l) { local.cards[id] = r; continue; }
      const win = better(r, l) ? r : l;
      local.cards[id] = { ...win, revealed: l.revealed || r.revealed, votes: mergeVotes(l.votes, r.votes), downs: mergeVotes(l.downs, r.downs) };
    }
  }
  // same shape and rule as votes: higher rev wins, a tie goes to hidden
  if (isObj(remote.revealed)) local.revealed = mergeVotes(local.revealed, cleanVotes(remote.revealed));
  if (isObj(remote.helpers)) local.helpers = mergeVotes(local.helpers, cleanVotes(remote.helpers));
  const o = remote.organiser;
  if (isObj(o) && isRev(o.rev) && typeof o.name === 'string') {
    const name = clean(o.name, 40), cur = local.organiser;
    // higher rev; on a tie a non-empty name beats empty, then the lexically smaller name
    const wins = o.rev !== cur.rev ? o.rev > cur.rev
      : name !== cur.name && (!cur.name || (name && name < cur.name));
    if (wins) local.organiser = { name, rev: o.rev };
  }
  return local;
}

export function actingOrganiser(board, present) {
  if (!present.length) return null;
  if (present.some((p) => p.name === board.organiser.name)) return board.organiser.name;
  return present.reduce((m, p) => (p.joinedAt < m.joinedAt || (p.joinedAt === m.joinedAt && p.name < m.name) ? p : m)).name;
}

const norm = (s) => s.trim().toLowerCase();
export function nameConflict(me, others) {
  return others.some((o) => norm(o.name) === norm(me.name) &&
    (o.joinedAt < me.joinedAt || (o.joinedAt === me.joinedAt && o.peerId < me.peerId)));
}
