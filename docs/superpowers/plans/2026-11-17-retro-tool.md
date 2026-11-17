# Retro Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A peer-to-peer retrospective board served as static files from GitHub Pages, where retro content only ever exists in participants' browser memory.

**Architecture:** Pure board model (`src/board.js`) with a commutative, idempotent `merge`; every change broadcasts the full board to all peers over a Trystero WebRTC mesh (`src/net.js`), and receivers merge. UI is plain DOM in `src/app.js`. No framework, no build step; Trystero is bundled once into `vendor/trystero.js`.

**Tech Stack:** Vanilla ES modules, Trystero 0.26.0 (Nostr strategy), `node --test` for tests (Node ≥ 20, no test deps).

**Spec:** `docs/superpowers/specs/2026-11-17-retro-tool-design.md`

## Global Constraints

- Retro content (cards, names, votes, live column names) lives in memory only. Never write it to localStorage, sessionStorage, IndexedDB, cookies, or URLs. Exception: the URL fragment may hold `code` and `name` (spec: refresh).
- localStorage holds only the column configuration under key `retro.columns` (JSON array of strings) and the theme override under `retro.theme` (`"light"` | `"dark"`).
- Nothing loaded from third-party origins. CSP meta: `default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self' <RELAYS>; base-uri 'none'; form-action 'none'`. No inline `<script>` or `style=""` attributes.
- All user/peer-provided text rendered with `textContent`, never `innerHTML`.
- Trystero pinned exactly: `trystero@0.26.0`, `@trystero-p2p/nostr@0.26.0`, `@trystero-p2p/core@0.26.0`, `@noble/secp256k1` exact version from the lockfile (no `^`). esbuild pinned exactly as a devDependency.
- `appId`: `'retro-tool'`. Trystero `roomId` and `password` are both the normalized session code.
- Relays: one exported constant `RELAYS` in `src/net.js`, the exact same list in the CSP `connect-src`. Start with `wss://nos.lol`, `wss://relay.damus.io`, `wss://relay.nostr.band`, `wss://relay.primal.net`, `wss://nostr.mom`.
- Visual design: follow the spec's "Visual design" section exactly (tokens, radii, layout, copy). Shantell Sans only, self-hosted. Hand-drawn wobbly shapes on everything except post-its.
- Card text max 1000 chars, display name max 40 chars, column name max 60 chars; trimmed; longer input is truncated.

## Review Focus

1. **Refresh while your old connection hasn't timed out yet**: your rejoin sees "your" name as still connected. Expect: retry for up to 15 s before showing "name in use", not an instant rejection. → Task 3 `nameConflict` test + Task 6 retry.
2. **Two peers edit/delete/vote concurrently, then sync in any order**: both converge to the same board, and deleted cards never come back. → Task 3 merge commutativity/idempotence/tombstone tests.
3. **Malformed or hostile data from a peer or an import file** (HTML in text, huge strings, wrong types, missing fields): it's sanitized, rendered as text, and nothing crashes. → Task 3 `merge` sanitize test, Task 4 `parseImport` tests.
4. **Joining a code nobody is in** (stale or mistyped): after 10 s with no peers, show "Nobody is in this session. It may have ended." and create no board. → Task 6.
5. **Last person refreshes or closes**: the `beforeunload` prompt fires only when you're alone. → Task 7 manual check.

---

### Task 1: Scaffold + session code

**Files:**
- Create: `package.json`, `.gitignore`, `src/code.js`, `test/code.test.js`

**Interfaces:**
- Produces: `generateCode(): string` returns `'XXXX-XXXX-XXXX-XXXX'` (16 chars from the Crockford alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ`, 80 bits). `normalizeCode(input: string): string | null` uppercases, strips everything except letters and digits, maps `O→0` and `I`/`L→1`, and returns the dashed form, or `null` unless exactly 16 valid chars remain.

- [ ] **Step 1:** `git init`. `package.json` = `{"name":"retro-tool","private":true,"type":"module","scripts":{"test":"node --test test/"}}`. `.gitignore`: `node_modules/`.
- [ ] **Step 2: Write failing tests** in `test/code.test.js`:
  - `generateCode` matches `/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/`, and 1000 calls give 1000 distinct codes.
  - `normalizeCode('7kq4 m9xd-2htp_wrz6') === '7KQ4-M9XD-2HTP-WRZ6'`, `normalizeCode('OIL0-0000-0000-0000') === '0110-0000-0000-0000'`, `normalizeCode('ABC') === null`, `normalizeCode('7KQ4-M9XD-2HTP-WRZU') === null` (U is not in the alphabet).
- [ ] **Step 3:** `npm test`. Expected: FAIL (module not found).
- [ ] **Step 4:** Implement `src/code.js` with `crypto.getRandomValues(new Uint8Array(16))`, `byte & 31` → alphabet index (32 symbols, so no modulo bias).
- [ ] **Step 5:** `npm test`. Expected: PASS.
- [ ] **Step 6:** Commit `feat: session code generation`.

### Task 2: Board model, local operations

**Files:**
- Create: `src/board.js`, `test/board.test.js`

**Interfaces:**
- Produces (all mutate `board` in place and return it; invalid actions are silent no-ops):
  - `createBoard(columns: string[]): Board`. `Board = {columns: {id, name}[], cards: {[id]: Card}, revealed: string[], organiser: {name: string, rev: number}}`. Column ids are `'c0'`, `'c1'`, ….
  - `Card = {id, column, text, author, rev, deleted, revealed, votes: {[voter]: {on: boolean, rev: number}}}`
  - `addCard(board, {id, column, text, author})`: `rev: 0`, `deleted: false`, `revealed = board.revealed.includes(author)`. Ids come from `crypto.randomUUID()` in the caller.
  - `editCard(board, id, text, by)`: only if `by === card.author` and not deleted; `rev + 1`.
  - `deleteCard(board, id, by)`: only by the author; sets `deleted: true`, `text: ''`, `rev + 1` (tombstone).
  - `toggleVote(board, id, voter)`: only on revealed, non-deleted cards; flips `votes[voter].on`, `rev + 1`.
  - `reveal(board, author)`: adds `author` to `revealed` and sets `revealed: true` on all their cards.
  - `setOrganiser(board, name)`: `organiser = {name, rev: rev + 1}`.
  - `addImported(board, items: {text, author}[], column: string)`: adds each as a new card with `revealed: true` and no votes.
  - `voteCount(card): number`: the number of voters with `on: true`.
- Text limits from Global Constraints are applied inside `addCard`/`editCard`/`createBoard`.

- [ ] **Step 1: Write failing tests**, one per function: the happy path, plus "a non-author can't edit/delete", "you can't vote on an unrevealed card", "a card added after its author is revealed is revealed", "voting twice returns `voteCount` to 0", "a 1200-char card is stored as 1000 chars".
- [ ] **Step 2:** `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement `src/board.js`.
- [ ] **Step 4:** `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: board model operations`.

### Task 3: Merge, organiser, name conflicts

**Files:**
- Modify: `src/board.js`, `test/board.test.js`

**Interfaces:**
- Produces:
  - `merge(local: Board, remote: unknown): Board`: mutates and returns `local`. Rules:
    - Columns: `local.columns` if non-empty, else sanitized `remote.columns`.
    - Cards: union by id. Higher `rev` wins. On equal `rev`: `deleted` wins, then the lexically larger `text` (for determinism). `revealed` is OR'd.
    - Votes: per voter, higher `rev` wins; on a tie `on: false` wins.
    - `revealed` lists are unioned.
    - Organiser: higher `rev` wins; on a tie the lexically smaller name wins.
    - Sanitize remote first: drop cards/columns with wrong types, truncate strings to the limits, ignore unknown fields. Never throw on garbage; `merge(b, null)`, `merge(b, 'x')` and `merge(b, {cards: 5})` leave `b` unchanged.
  - `actingOrganiser(board, present: {name: string, joinedAt: number}[]): string | null`: `board.organiser.name` if present; otherwise the present entry with the smallest `joinedAt`, tie → smallest name; `null` if `present` is empty. `present` includes yourself.
  - `nameConflict(me: {name, joinedAt, peerId}, others: {name, joinedAt, peerId}[]): boolean`: true if another entry has the same name (case-insensitive, trimmed) and `(joinedAt, peerId)` sorts before mine.

- [ ] **Step 1: Write failing tests:**
  - Commutative: given boards A and B built from different op sequences on a shared base, `merge(clone(A), B)` deep-equals `merge(clone(B), A)`.
  - Idempotent: `merge(clone(A), A)` deep-equals A.
  - A tombstone beats a concurrent edit at the same rev, and after another merge with the stale copy the card stays deleted.
  - Sanitize: a remote card with `text: '<img src=x onerror=alert(1)>'` is kept as a plain string; `text: 5` is dropped; garbage inputs leave the board unchanged.
  - Organiser handover (rev 1) beats the original (rev 0) in both merge orders.
  - `actingOrganiser`: organiser absent → earliest joiner; organiser back → organiser.
  - `nameConflict`: an earlier joiner with the same name → true for me and false for them; `'Anna '` vs `'anna'` conflict.
- [ ] **Step 2:** `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: board merge and roles`.

### Task 4: Export / import

**Files:**
- Create: `src/export.js`, `test/export.test.js`

**Interfaces:**
- Consumes: `Board`, `voteCount` (Task 2).
- Produces:
  - `toMarkdown(board, date: Date): string`. Format:
    - `# Retro YYYY-MM-DD`
    - then per column `## <name>`
    - then per non-deleted card `- <text> (👍 n)`, with newlines in the text replaced by spaces.
    - Columns are separated by a blank line. Unrevealed cards are included.
  - `toJSON(board, date: Date): string`: `{"version":1,"date":"YYYY-MM-DD","columns":[names],"cards":[{"column":name,"text","author","votes":n}]}`, pretty-printed with 2 spaces, no deleted cards.
  - `parseImport(text: string): {column: string, text: string, author: string}[]`: throws `Error('Not a retro export file')` on invalid JSON, `version !== 1`, or `cards` not an array; skips individual cards whose `text` isn't a non-empty string; truncates to the limits.
  - `download(filename: string, content: string, mime: string): void`: Blob + temporary `<a download>`. Browser only, untested.

- [ ] **Step 1: Write failing tests:** exact Markdown for a 2-column board with a 2-vote card, a deleted card (absent), and a multiline card; round trip `parseImport(toJSON(b))` returns the non-deleted cards; `parseImport('{}')`, `parseImport('nope')` and `parseImport('{"version":2,"cards":[]}')` throw; a card with `text: {}` is skipped.
- [ ] **Step 2:** `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: markdown and json export, import parsing`.

### Task 5: Vendored Trystero + network layer

**Files:**
- Create: `vendor/package.json`, `vendor/package-lock.json`, `vendor/entry.js`, `vendor/trystero.js` (generated, committed), `src/net.js`, `test/csp.test.js`, `README.md`

**Interfaces:**
- Produces:
  - `RELAYS: string[]` (Global Constraints list).
  - `connect({code, onBoard, onPresence}): {selfId: string, announce(me: {name, joinedAt}): void, broadcast(board): void, leave(): void}`
    - `joinRoom({appId: 'retro-tool', password: code, relayConfig: {urls: RELAYS}}, code)`.
    - Two actions: `hello` (sends `{name, joinedAt}`) and `board` (sends the full board).
    - On `onPeerJoin`: send your last `hello` and your current board to that peer (`{target: peerId}`). `connect` keeps the last board passed to `broadcast` for this.
    - Presence is a map `peerId → {name, joinedAt, peerId}`, updated by `hello`, removed on `onPeerLeave`. Call `onPresence(list)` on each change.
    - On `board` messages call `onBoard(data)`. The caller merges; `net.js` never interprets content.
- `vendor/entry.js`: `export {joinRoom, selfId} from 'trystero'`.

- [ ] **Step 1:** In `vendor/`, `npm install --save-exact trystero@0.26.0 esbuild@<latest release older than 14 days>`. Then edit `package.json` so every dependency, including `@noble/secp256k1` as resolved in the lockfile, is exact, and rerun `npm install`.
- [ ] **Step 2:** Build: `npx esbuild entry.js --bundle --format=esm --minify=false --outfile=trystero.js`. Record this exact command and the "upgrade = review the diff of trystero.js" rule in `README.md`.
- [ ] **Step 3:** Audit the bundle: `grep -oE '(wss?|https?)://[^"'\'' ]+' vendor/trystero.js | sort -u`. Expected: only the default relay/tracker/STUN literals of the library. Your `RELAYS` override replaces them, and STUN doesn't carry content. Note the result in the README.
- [ ] **Step 4: Write failing test** `test/csp.test.js`: read `index.html`, extract the `connect-src` from the CSP meta, and assert that it equals `'self'` plus `RELAYS` exactly (in any order). Importing `RELAYS` from `src/net.js` must work in Node, so put `RELAYS` in `src/relays.js` and re-export it from `net.js`. Create a minimal `index.html` containing just the CSP meta so the test can pass.
- [ ] **Step 5:** `npm test`. Expected: FAIL, then implement `src/relays.js` + `index.html` CSP, `npm test` → PASS.
- [ ] **Step 6:** Implement `src/net.js` per the interface (browser-only; verified in Task 6).
- [ ] **Step 7:** Commit `feat: vendored trystero and p2p transport`.

### Task 6: Setup, join, and connecting

**Files:**
- Modify: `index.html`
- Create: `src/app.js`, `style.css`, `fonts/shantell-sans-400.woff2`, `fonts/shantell-sans-600.woff2`, `fonts/OFL.txt`

**Interfaces:**
- Consumes: `generateCode`, `normalizeCode` (Task 1); the board functions (Tasks 2–3); `connect` (Task 5); `parseImport` (Task 4).
- Produces: the in-memory app state `{code, me: {name, joinedAt}, board, present}` and `render()`, used by Task 7.

Screens are `<section>`s toggled with `hidden`:

- **Home:** "Start a session" / "Join a session".
- **Setup:**
  - your name;
  - a column list (add, rename, ↑/↓, remove; prefilled from `localStorage['retro.columns']`, with a `try/catch` that falls back to empty; saved on Start);
  - an optional import (`<input type="file" accept=".json">` → `parseImport` → a checkbox list "text — author" + a target column `<select>`);
  - Start, disabled until there's a name and at least 1 column.
  - Start does: `generateCode`, `createBoard`, `addImported`, `setOrganiser(board, name)` with rev 0 (the starter is the initial organiser, so set `board.organiser = {name, rev: 0}` directly), then `location.hash = 'code=…&name=…'`, then connect.
- **Join:** code + name, with the code prefilled from `#code=`. If the hash has both code and name, join automatically. Joining starts with `createBoard([])`.
- **Connect flow:**
  - `connect(...)`, then `announce(me)`.
  - `onBoard` → `merge(state.board, data)` → `render()`.
  - `onPresence` → check `nameConflict`. If true, retry by leaving and reconnecting every 3 s for up to 15 s, then show "That name is in use in this session". Otherwise `render()`.
  - Joiner with no columns after 10 s and no peers: "Nobody is in this session. It may have ended." plus a Back button.
- `joinedAt = Date.now()` once per page load. A refresh gives a later `joinedAt`, which Review Focus #1 accepts via the retry.

- [ ] **Step 1:** Vendor the fonts: download `shantell-sans-latin-{400,600}-normal.woff2` from `@fontsource/shantell-sans` (pinned version) and `OFL.txt` from the Shantell Sans repo into `fonts/`; `@font-face` in `style.css`.
- [ ] **Step 2:** `style.css`: all spec tokens as custom properties on `:root` (whiteboard), redefined for blackboard under `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {…} }` and `:root[data-theme="dark"]`. The ☾/☀ button sets `document.documentElement.dataset.theme` and `retro.theme` (try/catch). Column colors are `--col-ink`/`--col-paper` set per column element from a 6-entry list, cycling.
- [ ] **Step 3:** Build the screens and flow.
- [ ] **Step 4:** `npm test`. Expected: PASS (CSP test still green; no inline scripts or styles added).
- [ ] **Step 5: Manual check.**
  - Serve with `npx serve .` or `python3 -m http.server`.
  - Open two browser windows. Start in A and join from B with the link.
  - B shows A's columns within ~10 s.
  - The DevTools console shows no CSP violations.
  - The Network tab shows only same-origin requests plus `RELAYS` websockets.
  - Joining a random code shows the "Nobody is in this session" message after 10 s.
  - Theme toggle switches both ways and survives a reload; with no override, the OS dark setting picks the blackboard.
- [ ] **Step 6:** Commit `feat: setup, join and connect screens`.

### Task 7: Board UI, reveal, voting, export, leaving

**Files:**
- Modify: `src/app.js`, `index.html`, `style.css`

**Interfaces:**
- Consumes: Task 6 state + `render()`, the board ops, `toMarkdown`, `toJSON`, `download`, `actingOrganiser`, `setOrganiser`, `reveal`.
- Every local op does: `op(state.board, …)` → `net.broadcast(state.board)` → `render()`.

Board screen:

- **Header:**
  - the code, plus a "Copy link" button that copies `location.origin + location.pathname + '#code=' + code`;
  - the participants list with face-down counts (`Anna 🂠🂠🂠`); "(organiser)" marks `actingOrganiser`;
  - for the acting organiser: "Reveal" next to each unrevealed participant, and "Make organiser" next to each other participant;
  - authors who left with face-down cards keep a dashed chip tagged "left" (derived from the board: authors with unrevealed, non-deleted cards who aren't present), so they can still be revealed;
  - "You're the only one here — closing this tab deletes the board" when `present.length === 1`.
- **Columns:**
  - each column shows revealed cards (text, `👍 n` toggle button, author) and your own unrevealed cards marked "hidden";
  - an add-card textarea per column (Enter = add, Shift+Enter = newline);
  - edit/delete on your own cards.
- **Export buttons:** "Export Markdown" (`retro-YYYY-MM-DD.md`, `text/markdown`) and "Export data" (`retro-YYYY-MM-DD.json`, `application/json`).
- **Leaving:** `beforeunload`: when `present.length === 1` and the board has any non-deleted card, call `preventDefault()` and set `returnValue = ''`.

- [ ] **Step 1:** Implement the board render and actions, styled per the spec's Post-its and Layout bullets (unrevealed own card striped with a dashed inset outline and the "face-down for others" tag; hover/focus shows Edit/Delete; "+ Add a card" slot per column).
- [ ] **Step 2:** `npm test`. Expected: PASS.
- [ ] **Step 3: Manual check (two windows A and B):**
  - B's new card shows face-down in A; A reveals B and the card shows its text in both.
  - Votes show the same count in both.
  - Close A: B becomes organiser. Reopen A via the link with the same name: A becomes organiser again.
  - A hands over to B; A leaves and returns; B is still organiser.
  - The exports open correctly, and the JSON imports on a new setup screen.
  - Close B with A present: no prompt. Then refresh A while alone: a "Leave site?" prompt.
  - A card with text `<b>x</b>` shows literally.
  - Both themes at 1400px and 375px wide: columns scroll horizontally, no page-level horizontal scroll, focus ring visible when tabbing.
- [ ] **Step 4:** Commit `feat: board, reveal, voting, export`.

### Task 8: Deploy notes

**Files:**
- Modify: `README.md`

- [ ] **Step 1:** Add to the README:
  - how to enable GitHub Pages: Settings → Pages → deploy from the `main` branch, root folder;
  - the privacy model in 5 bullets taken from the spec;
  - the known network risk: corporate networks may block WebRTC. The fix is `turnConfig` or a self-hosted relay; see spec approach B.
- [ ] **Step 2:** `npm test`. Expected: PASS.
- [ ] **Step 3:** Commit `docs: deployment and privacy notes`.
