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
3. Select the `main` branch and the root folder (`/`), then save.

There is no build step. The site is the static files in the repository.

## Privacy model

- **Content** (cards, names, votes, column names of a live session) travels only browser-to-browser over encrypted WebRTC. No server of ours stores it.
- **Public Nostr relays** (listed in `src/relays.js`) only help browsers find each other. They see encrypted connection setup, IP addresses and timing, never content.
- **Public STUN servers** (Google and Cloudflare defaults) see IP addresses during connection setup.
- **Board lives in memory only.** It disappears when the last tab closes. Nothing is written to IndexedDB or sessionStorage.
- **localStorage holds only the column names and the theme preference.** Anyone with the session code can join and see the board.

## Known network risk

Corporate networks may block direct WebRTC. If a session cannot connect there, either add a TURN server through Trystero's `turnConfig`, or move to the self-hosted relay approach (approach B in the design spec). Both are untested on the target network.
