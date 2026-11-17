import { voteCount } from './board.js';

const day = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const liveCards = (board) => Object.values(board.cards).filter((c) => !c.deleted);

export function toMarkdown(board, date) {
  const cards = liveCards(board);
  const cols = board.columns.map((col) => [
    `## ${col.name}`,
    ...cards.filter((c) => c.column === col.id).map((c) => `- ${c.text.replace(/\r?\n/g, ' ')} (👍 ${voteCount(c)})`),
  ].join('\n'));
  return [`# Retro ${day(date)}`, ...cols].join('\n\n');
}

export function toJSON(board, date) {
  const name = (id) => board.columns.find((c) => c.id === id)?.name ?? '';
  return JSON.stringify({
    version: 1,
    date: day(date),
    columns: board.columns.map((c) => c.name),
    cards: liveCards(board).map((c) => ({ column: name(c.column), text: c.text, author: c.author, votes: voteCount(c) })),
  }, null, 2);
}

export function parseImport(text) {
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!data || data.version !== 1 || !Array.isArray(data.cards)) throw new Error('Not a retro export file');
  const s = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  return data.cards.flatMap((c) => {
    const t = s(c?.text, 1000);
    return t ? [{ column: s(c.column, 60), text: t, author: s(c.author, 40) }] : [];
  });
}

export function download(filename, content, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
