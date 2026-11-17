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
