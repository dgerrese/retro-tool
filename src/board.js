const clean = (s, max) => String(s ?? '').trim().slice(0, max);
const live = (board, id) => {
  const c = Object.hasOwn(board.cards, id) ? board.cards[id] : null;
  return c && !c.deleted ? c : null;
};

export function createBoard(columns) {
  return {
    columns: columns.map((name, i) => ({ id: `c${i}`, name: clean(name, 60) })),
    cards: Object.create(null), // null prototype: peer-supplied keys like __proto__ stay plain keys
    revealed: [],
    organiser: { name: '', rev: 0 },
  };
}

export function addCard(board, { id, column, text, author }) {
  if (Object.hasOwn(board.cards, id) || !board.columns.some((c) => c.id === column)) return board;
  author = clean(author, 40);
  board.cards[id] = {
    id, column, text: clean(text, 1000), author,
    rev: 0, deleted: false, revealed: board.revealed.includes(author), votes: Object.create(null),
  };
  return board;
}

export function editCard(board, id, text, by) {
  const c = live(board, id);
  if (c && c.author === by) {
    c.text = clean(text, 1000);
    c.rev++;
  }
  return board;
}

export function deleteCard(board, id, by) {
  const c = live(board, id);
  if (c && c.author === by) {
    c.deleted = true;
    c.text = '';
    c.rev++;
  }
  return board;
}

export function toggleVote(board, id, voter) {
  const c = live(board, id);
  if (c && c.revealed) {
    const v = Object.hasOwn(c.votes, voter) ? c.votes[voter] : (c.votes[voter] = { on: false, rev: 0 });
    v.on = !v.on;
    v.rev++;
  }
  return board;
}

export function reveal(board, author) {
  if (!board.revealed.includes(author)) board.revealed.push(author);
  for (const c of Object.values(board.cards)) if (c.author === author) c.revealed = true;
  return board;
}

export function setOrganiser(board, name) {
  board.organiser = { name: clean(name, 40), rev: board.organiser.rev + 1 };
  return board;
}

export function addImported(board, items, column) {
  for (const { text, author } of items) {
    const id = crypto.randomUUID();
    addCard(board, { id, column, text, author });
    if (Object.hasOwn(board.cards, id)) board.cards[id].revealed = true;
  }
  return board;
}

export const voteCount = (card) => Object.values(card.votes).filter((v) => v.on).length;

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
    deleted, revealed: raw.revealed === true, votes: cleanVotes(raw.votes),
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
      local.cards[id] = { ...win, revealed: l.revealed || r.revealed, votes: mergeVotes(l.votes, r.votes) };
    }
  }
  if (Array.isArray(remote.revealed)) {
    const names = remote.revealed.map((n) => str(n, 40)).filter((n) => n !== null);
    local.revealed = [...new Set([...local.revealed, ...names])].sort();
  }
  // a card whose author was already revealed (concurrently) must not stay face-down
  for (const c of Object.values(local.cards)) c.revealed ||= local.revealed.includes(c.author);
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
