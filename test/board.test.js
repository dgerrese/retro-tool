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
  assert.deepEqual(mk(), {
    columns: [{ id: 'c0', name: 'Good' }, { id: 'c1', name: 'Bad' }],
    cards: {}, revealed: [], organiser: { name: '', rev: 0 },
  });
});

test('createBoard trims and truncates column names to 60', () => {
  assert.equal(createBoard(['  ' + 'x'.repeat(100)]).columns[0].name, 'x'.repeat(60));
});

test('addCard adds an unrevealed card', () => {
  const b = withCard(mk());
  assert.deepEqual(b.cards.a, {
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
  assert.deepEqual([b.cards.a.text, b.cards.a.rev, b.cards.a.votes], ['', 1, {}]);
});

test('you cannot vote on an unrevealed card', () => {
  const b = withCard(mk());
  toggleVote(b, 'a', 'Bob');
  assert.deepEqual(b.cards.a.votes, {});
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
    assert.deepEqual(c.votes, {});
    assert.equal(c.deleted, false);
  }
  assert.deepEqual(cards.map((c) => c.text), ['one', 'two']);
});
