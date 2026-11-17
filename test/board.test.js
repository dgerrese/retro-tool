import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createBoard, addCard, editCard, deleteCard, toggleVote,
  reveal, setOrganiser, addImported, voteCount,
} from '../src/board.js';

const mk = () => createBoard(['Good', 'Bad']);
const withCard = (b, over = {}) =>
  addCard(b, { id: 'a', column: 'c0', text: 'hi', author: 'Ann', ...over });

test('createBoard builds columns, empty state and organiser', () => {
  const b = mk();
  assert.deepEqual(b.columns, [{ id: 'c0', name: 'Good' }, { id: 'c1', name: 'Bad' }]);
  assert.deepEqual({ ...b.cards }, {});
  assert.deepEqual([b.revealed, b.organiser], [[], { name: '', rev: 0 }]);
});

test('createBoard trims and truncates column names to 60', () => {
  assert.equal(createBoard(['  ' + 'x'.repeat(100)]).columns[0].name, 'x'.repeat(60));
});

test('addCard adds an unrevealed card', () => {
  const b = withCard(mk());
  assert.deepEqual({ ...b.cards.a, votes: { ...b.cards.a.votes } }, {
    id: 'a', column: 'c0', text: 'hi', author: 'Ann',
    rev: 0, deleted: false, revealed: false, votes: {},
  });
});

test('a card added after its author is revealed is revealed', () => {
  const b = mk();
  reveal(b, 'Ann');
  assert.equal(withCard(b).cards.a.revealed, true);
});

test('a 1200-char card is stored as 1000 chars; author capped at 40', () => {
  const b = withCard(mk(), { text: 'y'.repeat(1200), author: 'n'.repeat(60) });
  assert.equal(b.cards.a.text.length, 1000);
  assert.equal(b.cards.a.author.length, 40);
});

test('addCard ignores unknown column and duplicate id', () => {
  const b = withCard(mk());
  addCard(b, { id: 'b', column: 'zz', text: 'x', author: 'Ann' });
  addCard(b, { id: 'a', column: 'c0', text: 'other', author: 'Bob' });
  assert.deepEqual(Object.keys(b.cards), ['a']);
  assert.equal(b.cards.a.text, 'hi');
});

test('editCard by author updates text and rev; truncates', () => {
  const b = withCard(mk());
  editCard(b, 'a', ' ' + 'z'.repeat(1200), 'Ann');
  assert.equal(b.cards.a.text.length, 1000);
  assert.equal(b.cards.a.rev, 1);
});

test('a non-author cannot edit or delete', () => {
  const b = withCard(mk());
  editCard(b, 'a', 'hacked', 'Bob');
  deleteCard(b, 'a', 'Bob');
  assert.equal(b.cards.a.text, 'hi');
  assert.equal(b.cards.a.deleted, false);
  assert.equal(b.cards.a.rev, 0);
});

test('deleteCard tombstones; deleted card cannot be edited or voted', () => {
  const b = withCard(mk());
  reveal(b, 'Ann');
  deleteCard(b, 'a', 'Ann');
  assert.deepEqual([b.cards.a.deleted, b.cards.a.text, b.cards.a.rev], [true, '', 1]);
  editCard(b, 'a', 'back', 'Ann');
  toggleVote(b, 'a', 'Bob');
  assert.deepEqual([b.cards.a.text, b.cards.a.rev, { ...b.cards.a.votes }], ['', 1, {}]);
});

test('you cannot vote on an unrevealed card', () => {
  const b = withCard(mk());
  toggleVote(b, 'a', 'Bob');
  assert.deepEqual({ ...b.cards.a.votes }, {});
});

test('voting twice returns voteCount to 0', () => {
  const b = withCard(mk());
  reveal(b, 'Ann');
  toggleVote(b, 'a', 'Bob');
  assert.equal(voteCount(b.cards.a), 1);
  assert.equal(b.cards.a.votes.Bob.rev, 1);
  toggleVote(b, 'a', 'Bob');
  assert.equal(voteCount(b.cards.a), 0);
  assert.equal(b.cards.a.votes.Bob.rev, 2);
  assert.equal(b.cards.a.votes.Bob.on, false);
});

test('reveal marks the author and all their cards only', () => {
  const b = withCard(mk());
  withCard(b, { id: 'b' });
  withCard(b, { id: 'c', author: 'Bob' });
  reveal(b, 'Ann');
  assert.deepEqual(b.revealed, ['Ann']);
  assert.deepEqual([b.cards.a.revealed, b.cards.b.revealed, b.cards.c.revealed], [true, true, false]);
  reveal(b, 'Ann');
  assert.deepEqual(b.revealed, ['Ann']);
});

test('setOrganiser bumps rev', () => {
  const b = mk();
  setOrganiser(b, 'Ann');
  assert.deepEqual(b.organiser, { name: 'Ann', rev: 1 });
  setOrganiser(b, 'Bob');
  assert.deepEqual(b.organiser, { name: 'Bob', rev: 2 });
});

test('addImported adds revealed vote-less cards in the column', () => {
  const b = mk();
  addImported(b, [{ text: 'one', author: 'Ann' }, { text: 'two', author: 'Bob' }], 'c1');
  const cards = Object.values(b.cards);
  assert.equal(cards.length, 2);
  for (const c of cards) {
    assert.equal(c.column, 'c1');
    assert.equal(c.revealed, true);
    assert.deepEqual({ ...c.votes }, {});
    assert.equal(c.deleted, false);
  }
  assert.deepEqual(cards.map((c) => c.text), ['one', 'two']);
});

test('setOrganiser trims and truncates to 40', () => {
  const b = setOrganiser(mk(), '  ' + 'o'.repeat(50));
  assert.equal(b.organiser.name, 'o'.repeat(40));
});

test('a __proto__ voter is an ordinary key and does not pollute Object.prototype', () => {
  const b = withCard(mk());
  reveal(b, 'Ann');
  toggleVote(b, 'a', '__proto__');
  assert.equal(voteCount(b.cards.a), 1);
  assert.equal(({}).on, undefined);
  assert.equal(({}).rev, undefined);
  toggleVote(b, 'a', '__proto__');
  assert.equal(voteCount(b.cards.a), 0);
});

test('a __proto__ card id is an ordinary key; no-ops do not pollute', () => {
  const b = mk();
  editCard(b, '__proto__', 'x', 'Ann');
  toggleVote(b, '__proto__', 'Bob');
  assert.equal(({}).on, undefined);
  addCard(b, { id: '__proto__', column: 'c0', text: 'p', author: 'Ann' });
  assert.equal(Object.hasOwn(b.cards, '__proto__'), true);
  assert.equal(b.cards['__proto__'].text, 'p');
  assert.equal(Object.getPrototypeOf(b.cards), null);
});

// ---- Task 3: merge, organiser, name conflicts ----
import { merge, actingOrganiser, nameConflict } from '../src/board.js';

const snap = (b) => JSON.parse(JSON.stringify(b));
const json = (b) => JSON.parse(JSON.stringify(b)); // simulates the wire
const sortKeys = (v) =>
  Array.isArray(v) ? v.map(sortKeys)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]))
      : v;
const same = (a, b) => assert.deepEqual(sortKeys(snap(a)), sortKeys(snap(b)));

const base = () => {
  const b = withCard(mk());
  addCard(b, { id: 'b', column: 'c1', text: 'other', author: 'Bob' });
  reveal(b, 'Ann'); reveal(b, 'Bob');
  return b;
};
const fork = (b) => merge(mk(), json(b));

test('merge is commutative and idempotent', () => {
  const A = fork(base()); const B = fork(base());
  editCard(A, 'a', 'edited by A', 'Ann'); toggleVote(A, 'b', 'Ann');
  deleteCard(B, 'b', 'Bob'); editCard(B, 'a', 'zzz', 'Ann'); toggleVote(B, 'a', 'Bob');
  same(merge(fork(A), json(B)), merge(fork(B), json(A)));
  same(merge(fork(A), json(A)), A);
});

test('tombstone beats concurrent edit and stays deleted', () => {
  const A = fork(base()); const B = fork(base());
  editCard(A, 'a', 'edit', 'Ann'); deleteCard(B, 'a', 'Ann');
  const stale = json(A);
  merge(A, json(B));
  assert.equal(A.cards.a.deleted, true);
  merge(A, stale);
  assert.equal(A.cards.a.deleted, true);
  assert.equal(A.cards.a.text, '');
});

test('votes merge per voter, tie goes to off', () => {
  const A = fork(base()); const B = fork(base());
  toggleVote(A, 'a', 'Cy'); toggleVote(B, 'a', 'Cy'); toggleVote(B, 'a', 'Cy');
  toggleVote(A, 'a', 'Di');
  merge(A, json(B));
  assert.equal(A.cards.a.votes.Cy.on, false);
  assert.equal(voteCount(A.cards.a), 1);
});

test('merge sanitizes remote and never throws on garbage', () => {
  const b = base(); const before = snap(b);
  for (const g of [null, 'x', 5, [], { cards: 5 }, { columns: 'x', cards: [], revealed: 1, organiser: 7 }]) {
    merge(b, g); same(b, before);
  }
  const r = json(base());
  r.cards.x = { id: 'x', column: 'c0', text: '<img src=x onerror=alert(1)>', author: 'E', rev: 0, deleted: false, revealed: false, votes: {} };
  r.cards.y = { id: 'y', column: 'c0', text: 5, author: 'E', rev: 0, deleted: false, revealed: false, votes: {} };
  r.cards.z = { id: 'z', column: 'nope', text: 'q', author: 'E', rev: 0, deleted: false, revealed: false, votes: {} };
  r.cards.w = { id: 'w', column: 'c0', text: 'q'.repeat(5000), author: 'n'.repeat(99), rev: -1, deleted: 'yes', revealed: 1, votes: { v: { on: 'x', rev: 1 } } };
  merge(b, r);
  assert.equal(b.cards.x.text, '<img src=x onerror=alert(1)>');
  assert.equal(Object.hasOwn(b.cards, 'y'), false);
  assert.equal(Object.hasOwn(b.cards, 'z'), false);
  assert.equal(Object.hasOwn(b.cards, 'w'), false); // negative rev
  r.cards.w.rev = 0; merge(b, r);
  const w = b.cards.w;
  assert.deepEqual([w.text.length, w.author.length, w.deleted, w.revealed, Object.keys(w.votes)], [1000, 40, false, false, []]);
});

test('merge copies into null-prototype objects and survives __proto__ keys', () => {
  const b = mk();
  const r = JSON.parse('{"columns":[],"cards":{"__proto__":{"id":"__proto__","column":"c0","text":"t","author":"E","rev":0,"deleted":false,"revealed":false,"votes":{"__proto__":{"on":true,"rev":1}}}},"revealed":[],"organiser":{"name":"","rev":0}}');
  merge(b, r);
  assert.equal(Object.getPrototypeOf(b.cards), null);
  assert.equal(Object.hasOwn(b.cards, '__proto__'), true);
  assert.equal(Object.getPrototypeOf(b.cards.__proto__.votes), null);
  assert.equal(Object.hasOwn(b.cards.__proto__.votes, '__proto__'), true);
  assert.equal({}.text, undefined);
  assert.equal({}.on, undefined);
});

test('joiner takes remote columns only when local has none', () => {
  const j = merge(createBoard([]), json(base()));
  assert.equal(j.columns.length, 2);
  merge(j, { columns: [{ id: 'c9', name: 'X' }] });
  assert.equal(j.columns.length, 2);
});

test('organiser handover beats original in both orders', () => {
  const A = setOrganiser(setOrganiser(mk(), 'Ann'), 'Bob'); // rev 2
  const B = setOrganiser(mk(), 'Ann'); // rev 1
  assert.equal(merge(snap2(B), json(A)).organiser.name, 'Bob');
  assert.equal(merge(snap2(A), json(B)).organiser.name, 'Bob');
});
const snap2 = (b) => merge(createBoard(b.columns.map((c) => c.name)), json(b));

test('empty joiner never overrides the starter organiser', () => {
  const s = setOrganiser(mk(), 'Dion');
  assert.equal(merge(createBoard([]), json(s)).organiser.name, 'Dion');
  assert.equal(merge(s, json(createBoard([]))).organiser.name, 'Dion');
});

test('organiser tie on equal rev picks lexically smaller non-empty name', () => {
  const a = setOrganiser(mk(), 'Zed'); const b = setOrganiser(mk(), 'Amy');
  assert.equal(merge(a, json(b)).organiser.name, 'Amy');
});

test('actingOrganiser', () => {
  const b = setOrganiser(mk(), 'Ann');
  const p = [{ name: 'Cy', joinedAt: 5 }, { name: 'Bob', joinedAt: 2 }, { name: 'Abe', joinedAt: 2 }];
  assert.equal(actingOrganiser(b, p), 'Abe');
  assert.equal(actingOrganiser(b, [...p, { name: 'Ann', joinedAt: 9 }]), 'Ann');
  assert.equal(actingOrganiser(b, []), null);
});

test('nameConflict', () => {
  const me = { name: 'Anna ', joinedAt: 5, peerId: 'p2' };
  const early = { name: 'anna', joinedAt: 3, peerId: 'p1' };
  assert.equal(nameConflict(me, [early]), true);
  assert.equal(nameConflict(early, [me]), false);
  assert.equal(nameConflict({ ...me, joinedAt: 3, peerId: 'p0' }, [early]), false);
  assert.equal(nameConflict(me, [{ name: 'Bob', joinedAt: 1, peerId: 'p0' }]), false);
});

test('merge reveals a new unsynced card whose author the organiser already revealed', () => {
  const org = mk(); org.revealed = ['Anna'];
  const anna = withCard(mk(), { id: 'n', author: 'Anna' });
  const a = merge(structuredClone(org), json(anna));
  const b = merge(structuredClone(anna), json(org));
  assert.equal(a.cards.n.revealed, true);
  assert.equal(b.cards.n.revealed, true);
});
