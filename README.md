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
