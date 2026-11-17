# Retro tool — design

Date: 2026-11-17

## Intent

A retrospective board for a team, hosted as static files on GitHub Pages. Retros may contain client information and internal company details, so **retro content must never reach any party other than the participants** — no server stores it, relays it readably, or logs it. Sessions are ephemeral: a board exists only in participants' open tabs and is gone when the last one closes.

## Goals

- Start a session, get a random session code, others join with code + display name.
- Writing phase: everyone writes cards; others see them face-down until revealed.
- Organiser reveals cards person by person so each person can elaborate.
- Voting with counts visible on the card face.
- Export as Markdown (human-readable) and JSON (importable).
- Setup screen: configure columns (remembered between sessions) and import previous action items from a JSON export.

## Non-goals

- Accounts, login, persistence on any server, history of past sessions.
- Default/standard column sets. Columns always come from the setup screen.
- Hiding unrevealed cards from devtools. Face-down is a UI convention, not a secrecy guarantee (user's explicit choice: surviving drops matters more).
- Grouping/merging cards, timers, comments, markdown in cards.

## Anti-goals (failure even if it works)

- Any retro content (card text, names, votes, column names of a live session) reaching a third party in readable form.
- Loading any script, style, font, or analytics from a third-party origin.
- Retro content lingering on a participant's disk after their tab closes. Content lives in memory only: no localStorage, sessionStorage or IndexedDB (browsers restore sessionStorage on tab reopen / session restore and Firefox persists it to disk).

## Constraints

- Static hosting only (GitHub Pages). No backend owned by us.
- Plain HTML/CSS/JS, no framework, no build step for the app. Trystero **0.26.0** (released 2026-10-04; deliberately not the newest release, to avoid days-old code) is vendored as a single ES module file. *(Builder's call, recorded here:)* 0.26.0 is a shim over `@trystero-p2p/nostr` + `@trystero-p2p/core` + `@noble/secp256k1`, so the vendored file is produced once with esbuild from a pinned `package-lock.json`; the exact command lives in the README and is rerun only when upgrading. The bundle is committed and reviewed like source.
- A Content-Security-Policy `<meta>` tag: `default-src 'self'`; `connect-src` limited to `'self'` plus the exact signaling relay and STUN hosts Trystero uses. No inline scripts.

## Approaches considered

| | Approach | Trade-off | Decision |
|---|---|---|---|
| A | **Trystero (vendored), public decentralised relays for discovery, WebRTC mesh for data.** Signaling encrypted with a password derived from the session code. | Depends on public relays being up; relays/STUN see IPs and timing, never content. Nothing to host. | **Chosen** |
| B | Self-hosted tiny relay + browser-side AES-GCM of all content. | No third party at all, works on any network; but no longer Pages-only, something to run. | Fallback if A fails on the company network. |
| — | PeerJS cloud | Its signaling server could man-in-the-middle the connection. | Ruled out |
| — | Manual copy-paste SDP | Unusable beyond two people. | Ruled out |

Known risk (untested, user skipped the spike; first thing to verify on the company network once built): corporate networks may block direct WebRTC. If so, add a TURN server via Trystero's `turnConfig` (TURN only sees DTLS-encrypted traffic) or move to B.

## Security model

- **Session code**: random, generated with `crypto.getRandomValues`, at least ~80 bits, shown in a readable grouped form (e.g. `7KQ4-M9XD-2HTP-WRZ6`, unambiguous alphabet). Whoever has the code is a trusted participant.
- **Room id vs password**: the code is never sent to relays in the clear. Trystero 0.26.0 already publishes only `SHA-256("Trystero:" + appId + ":" + roomId)` as the room topic, so the code is used as both `roomId` and `password`. Connection offers (SDPs) are AES-GCM encrypted *and authenticated* with a key derived from the code, so a relay can neither read nor substitute them (no relay man-in-the-middle); a challenge/response on the code runs after connecting. *(Verified in the 0.26.0 source; 0.26.0 has no DTLS-fingerprint identity check — that arrived in 0.27.)*
- **Relays**: a fixed, short list of Nostr relays passed via `relayConfig.urls` (not Trystero's long default list), mirrored exactly in the CSP `connect-src`.
- **Data path**: all content goes peer-to-peer over WebRTC data channels (DTLS-encrypted).
- **Exposure accepted**: public relays and STUN servers see participant IP addresses and connection timing.
- **Storage**:
  - Board and identity: **in memory only** (user decision). A refresh recovers from peers.
  - `localStorage`: column configuration, your display name (prefills setup and join), theme. Never card content.
  - `sessionStorage`: on reload only, `retro.reload` = code, column names, organiser/had-cards flags. Never card content.
  - Accepted loss: the last participant crashing or force-closing loses the board.

## Session lifecycle

1. **Setup screen** (start a session): configure columns (add / rename / reorder / remove; prefilled from localStorage if present, otherwise empty). Optionally import a JSON export: its cards are listed with checkboxes; the organiser ticks which to carry over and picks the target column for them (e.g. "Previous action items"). Imported cards arrive already revealed. Only the Start session button starts the session (Enter in a field does not). It generates the code; the starter becomes organiser.
2. **Join screen**: enter code + display name. Via a link (`#code` in the URL fragment, never sent to GitHub) the code is prefilled.
3. **Live session**: see Board behaviour.
4. **End**: there is no end button. A session exists while at least one tab has it open (in memory). When you are the only one connected, the header says so and closing or refreshing the tab triggers the browser's "Leave site?" prompt (`beforeunload`), since either loses the board. Otherwise closing is silent. Joining a code after everyone left finds nobody: after 10 s the joiner sees "Nobody is in this session. It may have ended." (a joiner has no columns to start a board with). Old content is never recoverable.
5. **Refresh**: the tab comes straight back to the board (code + name from the URL fragment; column names, "was organiser" and "had cards" from sessionStorage, written on `pagehide` — never card text) and merges in whatever peers still hold. The organiser stays organiser. Alone → the cards are gone; if there were any, after ~10 s with no peer a banner says the reload cleared the board (no banner if the board was empty or a peer brought the cards back). Name clashes fail at once (no retry: a reloaded tab can never see its own old connection, because names only come from hellos other tabs send).

## Identity and the organiser role

- **Identity = display name** within a session. Rejoining with the same name (from any tab/device) reclaims your cards, votes and roles. A name currently connected cannot be taken by another joiner.
- **Organiser**: whoever started the session. Can reveal per person and has "Make organiser" next to each participant to hand over the role permanently.
- **Organiser drops**: the longest-connected remaining participant becomes *acting* organiser, so revealing can continue. When the organiser rejoins (by name), the role returns to them automatically. After a handover, the new organiser is the one the role returns to.

## Board behaviour

- **Everyone holds the full board** (full mesh). Late joiners receive the full state from any present peer. As long as one participant remains, nothing is lost.
- **Cards**: text, column, author (name), revealed flag, votes. Authors can add/edit/delete their own cards. Any card exists for all peers immediately; unrevealed cards render face-down under the author (`Anna: 🂠 🂠 🂠`), text not shown.
- **Reveal**: organiser clicks a participant → all their cards flip face-up for everyone. Authors who left with unrevealed cards keep a chip (dashed, tagged "left") so they can still be revealed; the chip disappears once nothing of theirs is face-down. *(Claude's call, found while drawing the full UI.)* Cards created by that person after their reveal are face-up immediately.
- **Votes**: one vote per person per card, toggleable; count shown on the card face (`👍 3`). Voting is open on revealed cards at any time. You can't vote on your own cards (they show the count only).
- **Hide (undo a reveal)**: the acting organiser can Hide a revealed person again to undo an accidental click; their cards go face-down (votes are kept) until revealed again. Reveal state is per author, last write wins, a tie goes to hidden. Imported cards always stay face-up.
- **Concurrency**: each card is owned by its author (only they edit text); votes are per-voter sets; so concurrent edits never conflict. Merge on sync = union by card id, author's latest version wins for text, vote sets merged per voter.

## Export / import

- **Export Markdown**: `# Retro <date>`, `## <column>` per column, `- <card text> (👍 n)` per card. Unrevealed cards included (export is the exporter's choice). Downloaded via Blob + `<a download>`.
- **Export data (JSON)**: `{version: 1, date, columns: [...], cards: [{column, text, author, votes}]}`. Used only for import on the setup screen. Import validates shape and ignores anything unexpected; text is always rendered as text, never HTML.
- Available to everyone at any time during the session.

## Left to the builder

- Exact message protocol over Trystero `makeAction`. Note 0.26.0 has no `makeState`/`roles`: sync, card versioning, and organiser/acting-organiser election are ours to build. Deletes need tombstones so a merge doesn't resurrect them.
- Signaling strategy: Trystero's default (Nostr) unless it proves unreliable.
- Two simultaneous joins with the same name: pick a deterministic tiebreak.
- The exact relay/STUN host list for the CSP, taken from the vendored Trystero version's defaults.

## Visual design (decided with mockups, 2026-11-17)

**Direction:** whiteboard (light) and blackboard (dark), hand-drawn throughout, **except the post-its**, which are clean paper (including the vote pill on them).

**Theme:** follows `prefers-color-scheme`; a ☾/☀ button in the top bar overrides it, remembered in localStorage key `retro.theme` (`"light"` | `"dark"`). A preference only, never content.

**Type:** Shantell Sans everywhere (400 body and card text, 600 headings, buttons, labels). Self-hosted woff2 files in `fonts/` with the OFL licence file; CSP `font-src 'self'`.

**Hand-drawn style ("wobbly shapes"):** single 2px lines with uneven elliptical corner radii, no filters, no libraries.
- Button: `border-radius: 255px 15px 225px 15px / 15px 225px 15px 255px`, primary = filled with the text color
- Input: soft line color, `border-radius: 15px 225px 15px 255px / 255px 15px 225px 15px`
- Participant chip: soft line color, `border-radius: 225px 25px 205px 35px / 35px 205px 25px 225px`
- Checkbox: `border-radius: 4px 7px 3px 8px / 8px 3px 7px 4px`
- Warning banner: dashed, warn color, same radius as button
- Column header: 600 20px, column color, 3px underline with `border-radius: 0 0 60% 10% / 0 0 6px 3px` (dashed on blackboard)
- Face-down card in a chip: small filled rectangle, `border-radius: 2px 4px 1px 3px`; up to 3 overlap in a fan (rotated −10°, −2°, +8°, offset 4px) with a 1.5px field-colored edge, followed by the count

**Tokens:**

| | Whiteboard | Blackboard |
|---|---|---|
| background | `#fbfcfd` + dot grid `radial-gradient(#dfe4ea 1px, transparent 1px) 0 0 / 16px 16px` | `#26302d` |
| text / line | `#1a2230` | `#eef3ef` |
| muted | `#5b6573` | `#a9b5af` |
| soft line | `#9aa5b1` | `#8a9a92` |
| field / chip bg | `#ffffff` | `#33403b` |
| accent (session code) | `#2459c9` | `#a5d0ff` |
| warn bg / warn | `#fff4d6` / `#8a6100` | `#3d3a26` / `#f3d98b` |
| error bg / error | `#ffe3e3` / `#a61e1e` | `#4a2d2d` / `#ffc2c2` |
| note text | `#1a2230` | `#17201c` |

Column colors cycle in order (header ink / post-it paper):

| # | Whiteboard | Blackboard |
|---|---|---|
| 1 | `#2b8a3e` / `#d3f9d8` | `#9be7a8` / `#c8e6cd` |
| 2 | `#2459c9` / `#d0ebff` | `#a5d0ff` / `#c9dff5` |
| 3 | `#c92a2a` / `#ffe3e3` | `#ffb3b3` / `#f2d0d0` |
| 4 | `#9c6500` / `#fff3bf` | `#ffd98a` / `#efe2b8` |
| 5 | `#7048e8` / `#e5dbff` | `#c5b3ff` / `#ddd3f5` |
| 6 | `#0b7285` / `#c5f6fa` | `#8ce3ef` / `#c4e8ec` |

**Post-its:** paper color of their column, no border, `box-shadow: 1px 2px 0 rgba(0,0,0,.08), 2px 4px 8px rgba(0,0,0,.10)`, alternating rotation −0.7° / +0.6° , 14px/1.4 text. Footer: author left, vote pill right (`👍 n`, pill outline `rgba(0,0,0,.28)`; voted = filled with note text color).
- Your unrevealed card: diagonal stripes of its paper color, 2px dashed outline inset 5px, tag "face-down for others".
- Your card on hover/focus: "Edit" and "Delete" appear in the card footer, in space that is always reserved, so the card never changes size (always visible on touch screens). Editing in place: Enter saves, Shift+Enter newline, Esc cancels.
- "+ Add a card" slot at the end of each column: dashed outline in the column color.

**Layout:**
- Top bar: `Session <code>` + Copy link (left); Export Markdown, Export data, ☾/☀ (right).
- Participant chips under the top bar: name, "(you)", "organiser" tag, face-down cards as a small fanned pile of at most 3 card backs plus the number (fixed width at any count), "revealed" once revealed. The acting organiser sees "Reveal" (primary) and "Make organiser" in the other chips.
- "You're the only one here. Closing this tab deletes the board, so export first if you want to keep it." banner under the chips when alone.
- Columns in a grid, `repeat(n, minmax(180px, 1fr))`, horizontal scroll if they don't fit.
- Home: title "Retro", a short explanation ("A board for team retrospectives. Start a session and share the code. Everyone writes cards in silence, and the organiser reveals them person by person so each of you can talk through your own. Vote on what matters most, then export the board before you leave.") and the privacy promise ("No accounts and no server: the board lives only in the browsers of the people in the session, and it's gone when the last person leaves."), then Start a session (primary) and Join a session (big buttons).
- Join and Setup: centered column max 360px; errors in an error box under the form. Setup column rows: color stripe, name input, ↑ ↓ ✕; "+ Add column"; "Carry over from last retro (optional)" box with a dashed outline.

**Accessibility floor:** visible focus ring (2px offset outline in the accent color) on everything focusable; all controls are real `<button>`/`<input>`; text contrast ≥ 4.5:1 on both themes.
