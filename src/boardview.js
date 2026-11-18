import { addCard, editCard, deleteCard, toggleVote, moveCard, reveal, hide, shown, isRevealed, setOrganiser, setHelper, isHelper, canOrganise, voteCount, actingOrganiser } from './board.js';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

// Typing state survives re-renders: drafts per column, the card being edited, and focus by data-key.
const drafts = Object.create(null);
let editing = null; // {id, text}
let focusNext = null;

const live = (board) => Object.values(board.cards).filter((c) => !c.deleted);

export function renderBoard(state, commit) {
  const { board, me } = state;
  const rerender = () => renderBoard(state, commit);
  const act = (f) => () => { f(); commit(); };

  const keyed = (node, key) => { node.dataset.key = key; return node; };
  const button = (label, cls, key, onClick) => {
    const b = keyed(el('button', cls, label), key);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  };

  // remember focus + caret
  const a = document.activeElement;
  const focus = { key: focusNext ?? a?.dataset?.key, start: a?.selectionStart, end: a?.selectionEnd };
  focusNext = null;

  const cards = live(board);
  if (editing && !cards.some((c) => c.id === editing.id && c.author === me.name)) editing = null;
  const up = (c) => isRevealed(board, c);
  const facedown = (name) => cards.filter((c) => c.author === name && !up(c)).length;
  const acting = actingOrganiser(board, state.present);
  const iOrganise = acting === me.name;
  const iHelp = canOrganise(board, me.name, state.present); // organiser or helper

  // ---- participants ----
  const people = new Map([[me.name, state.present.find((p) => p.name === me.name) ?? me]]);
  for (const p of [...state.present].sort((x, y) => x.joinedAt - y.joinedAt)) if (!people.has(p.name)) people.set(p.name, p);
  const left = [...new Set(cards.filter((c) => !up(c)).map((c) => c.author))].filter((n) => !people.has(n));

  const chip = (name, isLeft) => {
    const n = facedown(name), isMe = name === me.name;
    const c = el('span', `chip${name === acting ? ' org' : ''}${isLeft ? ' left' : ''}`, isMe ? `${name} (you)` : name);
    if (name === acting) c.append(el('span', 'tag', 'organiser'));
    else if (isHelper(board, name)) c.append(el('span', 'tag', 'helper'));
    if (isLeft) c.append(el('span', 'tag', 'left'));
    if (n) {
      const pile = el('span', 'pile');
      pile.setAttribute('role', 'img');
      pile.setAttribute('aria-label', `${n} face-down card${n === 1 ? '' : 's'}`);
      const stack = el('span', 'stack');
      for (let i = 0; i < Math.min(n, 3); i++) stack.append(el('i'));
      pile.append(stack, el('span', 'n', String(n)));
      c.append(pile);
    }
    const isShown = shown(board, name);
    if (isShown && !n && !isMe) c.append(el('span', 'tag', 'revealed'));
    if (iHelp && n) {
      const b = button('Reveal', 'btn sm primary', `reveal:${name}`, act(() => reveal(board, name)));
      b.setAttribute('aria-label', `Reveal ${name}'s cards`);
      c.append(b);
    }
    // undo an accidental reveal: only when they have cards that the reveal turned face-up
    if (iHelp && isShown && cards.some((x) => x.author === name && !x.revealed)) {
      const b = button('Hide', 'btn sm', `hide:${name}`, act(() => hide(board, name)));
      b.setAttribute('aria-label', `Hide ${name}'s cards again`);
      c.append(b);
    }
    if (iOrganise && !isMe && !isLeft) {
      const b = button('Make organiser', 'btn sm', `org:${name}`, act(() => setOrganiser(board, name)));
      b.setAttribute('aria-label', `Make ${name} organiser`);
      const helps = isHelper(board, name);
      const h = button(helps ? 'Remove helper' : 'Make helper', 'btn sm', `help:${name}`, act(() => setHelper(board, name, !helps)));
      h.setAttribute('aria-label', helps ? `Remove ${name} as helper` : `Make ${name} a helper`);
      c.append(b, h);
    }
    return c;
  };
  document.getElementById('people').replaceChildren(...[...people.keys()].map((n) => chip(n, false)), ...left.map((n) => chip(n, true)));
  document.getElementById('alone').hidden = state.present.length !== 1;

  // ---- columns ----
  const textarea = (key, value, label) => {
    const t = keyed(el('textarea'), key);
    t.value = value;
    t.maxLength = 1000;
    t.rows = 2;
    t.setAttribute('aria-label', label);
    return t;
  };
  const enterKey = (t, onEnter, onEsc) => t.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); onEnter(); }
    else if (e.key === 'Escape') { e.preventDefault(); onEsc(); }
  });

  const note = (card) => {
    const mine = card.author === me.name;
    if (editing?.id === card.id) {
      const n = el('div', 'note editing');
      const t = textarea(`edit:${card.id}`, editing.text, 'Edit card');
      t.addEventListener('input', () => { editing.text = t.value; });
      const done = (save) => {
        const text = t.value.trim();
        if (save && text && text !== card.text) editCard(board, card.id, text, me.name);
        editing = null;
        focusNext = `editbtn:${card.id}`;
        save ? commit() : rerender();
      };
      enterKey(t, () => done(true), () => done(false));
      n.append(t, el('div', 'hint', 'Enter saves · Shift+Enter new line · Esc cancels'));
      return n;
    }
    const n = el('div', `note${mine ? ' mine' : ''}${up(card) ? '' : ' hidden'}`);
    n.append(el('div', 'text', card.text));
    const meta = el('div', 'meta');
    meta.append(up(card) ? el('span', null, mine ? `${card.author} (you)` : card.author) : el('span', 'ntag', 'face-down for others'));
    // Edit/Delete sit in the footer with their space always reserved, so hovering never resizes the card
    if (mine) {
      const tools = el('span', 'tools');
      tools.append(
        button('Edit', null, `editbtn:${card.id}`, () => {
          editing = { id: card.id, text: card.text };
          focusNext = `edit:${card.id}`;
          rerender();
        }),
        button('Delete', null, `del:${card.id}`, act(() => deleteCard(board, card.id, me.name))));
      meta.append(tools);
    }
    if (up(card)) {
      for (const [kind, icon, word] of [['votes', '👍', 'Thumbs up'], ['downs', '👎', 'Thumbs down']]) {
        const votes = voteCount(card, kind);
        if (mine) {
          // you can't vote on your own card; just show the count
          const v = el('span', 'vote own', `${icon} ${votes}`);
          v.setAttribute('aria-label', `${word}: ${votes}`);
          meta.append(v);
        } else {
          const on = card[kind][me.name]?.on === true;
          const v = button(`${icon} ${votes}`, `vote${on ? ' on' : ''}`, `${kind}:${card.id}`, act(() => toggleVote(board, card.id, me.name, kind)));
          v.setAttribute('aria-pressed', on);
          v.setAttribute('aria-label', `${word} (${votes})`);
          meta.append(v);
        }
      }
    }
    n.append(meta);
    if (!iHelp) return n;
    n.draggable = true;
    n.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-card', card.id); e.dataTransfer.effectAllowed = 'move'; });
    return n;
  };

  document.getElementById('cols').replaceChildren(...board.columns.map((col) => {
    const c = el('div', 'col');
    c.append(el('h2', 'colh', col.name));
    c.addEventListener('dragover', (e) => {
      if (!iHelp || !e.dataTransfer.types.includes('text/x-card')) return;
      e.preventDefault();
      c.classList.add('drop');
    });
    c.addEventListener('dragleave', (e) => { if (!c.contains(e.relatedTarget)) c.classList.remove('drop'); });
    c.addEventListener('drop', (e) => {
      e.preventDefault();
      c.classList.remove('drop');
      if (!iHelp) return;
      moveCard(board, e.dataTransfer.getData('text/x-card'), col.id);
      commit();
    });
    // others' face-down cards stay in their pile; only revealed cards and your own show here
    for (const card of cards) if (card.column === col.id && (up(card) || card.author === me.name)) c.append(note(card));
    const add = textarea(`add:${col.id}`, drafts[col.id] ?? '', `Add a card to ${col.name}`);
    add.className = 'add';
    add.placeholder = '+ Add a card';
    add.rows = 1;
    add.addEventListener('input', () => { drafts[col.id] = add.value; });
    enterKey(add, () => {
      const text = add.value.trim();
      if (!text) return;
      addCard(board, { id: crypto.randomUUID(), column: col.id, text, author: me.name });
      drafts[col.id] = '';
      commit();
    }, () => add.blur());
    c.append(add, el('div', 'hint add-hint', 'Enter adds · Shift+Enter new line'));
    return c;
  }));

  // restore focus + caret
  if (focus.key) {
    const t = [...document.querySelectorAll('#board [data-key]')].find((x) => x.dataset.key === focus.key);
    if (t) {
      t.focus({ preventScroll: true });
      if (t.tagName === 'TEXTAREA') {
        const end = t.value.length;
        t.setSelectionRange(focus.start ?? end, focus.end ?? end);
      }
    }
  }
}
