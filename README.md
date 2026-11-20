# Retro

Peer-to-peer retrospective board. Static files, no build step for the app.
Retro content travels only browser-to-browser over WebRTC; public Nostr relays
see only encrypted connection setup (SDPs encrypted with a key derived from the session code).

## Vendored Trystero

`vendor/trystero.js` is a committed bundle of Trystero 0.26.0 (Nostr strategy). Rebuild:

    cd vendor && npm install && npx esbuild entry.js --bundle --format=esm --minify=false --outfile=trystero.js

Upgrade rule: bump the exact versions in `vendor/package.json`, rebuild, and review the diff of `trystero.js` before committing.

Bundle audit: `grep -oE '(wss?|https?)://[^"'\'' ]+' vendor/trystero.js | sort -u` finds no live URLs
(only a comment link). The library's default relay list is bare hostnames prefixed with `wss://` at runtime;
`RELAYS` overrides it via `relayConfig.urls`. The default STUN servers (Google, Cloudflare) are still used
for ICE and see IP addresses, never content. No `fetch`, `XMLHttpRequest`, `sendBeacon`, or web storage in the bundle.

## Deploying to GitHub Pages

1. In the repository, go to Settings → Pages.
2. Under "Build and deployment", choose "Deploy from a branch".
3. Select the `master` branch and the root folder (`/`), then save.

There is no build step. The site is the static files in the repository.

## Privacy model

- **Content** (cards, names, votes, column names of a live session) travels only browser-to-browser over encrypted WebRTC. The app is static files, so there is no server of ours in the content path.
- **Public Nostr relays** (listed in `src/relays.js`) only help browsers find each other. They see encrypted connection setup, IP addresses and timing, never content.
- **Public STUN servers** (Google and Cloudflare defaults) see IP addresses during connection setup.
- **Cards live in memory only.** They disappear when the last tab closes. When you reload, the tab keeps the session code, the column names and two yes/no flags (were you organiser, were there cards) in sessionStorage so it can come straight back to the board; card text is never stored. If you were alone, the reload clears the cards and the board says so. The app does not use IndexedDB.
- The session code and your name are in the page URL after `#`, so they end up in browser history. Anyone with access to that history can join a live session.
- Browser features you enable (for example enhanced spell check or page translation) may send typed text to the browser vendor. The app sets `translate="no"`.
- **localStorage holds only your column setup, your display name and the theme preference.** Anyone with the session code can join and see the board.
- On GitHub Pages the app shares the `dgerrese.github.io` origin with every other Pages project of this account. Those pages can read and change this app's localStorage and, in the same tab, its sessionStorage. Serve the app from its own domain if that matters.

## Known network risk

Corporate networks may block direct WebRTC. If a session cannot connect there, either add a TURN server through Trystero's `turnConfig`, or move to the self-hosted relay approach (approach B in the design spec). Both are untested on the target network.
