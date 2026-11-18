import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBoard, addCard, deleteCard, reveal, toggleVote } from '../src/board.js';
import { toMarkdown, toJSON, parseImport } from '../src/export.js';

const date = new Date(2026, 10, 7);
function mk() {
  const b = createBoard(['Good', 'Bad']);
  addCard(b, { id: 'a', column: 'c0', text: 'Shipped it', author: 'Ann' });
  addCard(b, { id: 'b', column: 'c0', text: 'gone', author: 'Ann' });
  addCard(b, { id: 'c', column: 'c1', text: 'line1\nline2', author: 'Bob' });
  reveal(b, 'Ann');
  toggleVote(b, 'a', 'Cy');
  toggleVote(b, 'a', 'Bob');
  deleteCard(b, 'b', 'Ann');
  return b;
}

test('toMarkdown exact', () => {
  assert.equal(toMarkdown(mk(), date),
    '# Retro 2026-11-07\n\n## Good\n- Shipped it (👍 2 👎 0)\n\n## Bad\n- line1 line2 (👍 0 👎 0)');
});

test('toJSON round trip skips deleted', () => {
  const out = JSON.parse(toJSON(mk(), date));
  assert.equal(out.date, '2026-11-07');
  assert.deepEqual(out.columns, ['Good', 'Bad']);
  assert.equal(out.cards.length, 2);
  assert.deepEqual(parseImport(toJSON(mk(), date)), [
    { column: 'Good', text: 'Shipped it', author: 'Ann' },
    { column: 'Bad', text: 'line1\nline2', author: 'Bob' },
  ]);
});

test('parseImport rejects bad files', () => {
  for (const t of ['{}', 'nope', '{"version":2,"cards":[]}', '{"version":1,"cards":{}}'])
    assert.throws(() => parseImport(t), { message: 'Not a retro export file' });
});

test('parseImport skips bad cards and truncates', () => {
  const r = parseImport(JSON.stringify({ version: 1, cards: [
    { column: 'x', text: {}, author: 'a' }, null, { text: '  ' },
    { column: 'c'.repeat(99), text: 't'.repeat(2000), author: 'a'.repeat(99) },
  ] }));
  assert.equal(r.length, 1);
  assert.deepEqual([r[0].column.length, r[0].text.length, r[0].author.length], [60, 1000, 40]);
});
